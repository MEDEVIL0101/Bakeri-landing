// google-calendar-sync
// One-way push (Bakeri → Google): reconciles the baker's baking_tasks and orders
// against events in their dedicated "Bakeri Schedule" Google Calendar. Called from
// the iOS app on demand ("Sync Now") and piggybacked on SyncService's existing
// foreground/5-min sync cadence.
//
// POST (no body required)
// Auth: Bearer {baker's Supabase JWT}
//
// Required env vars:
//   GOOGLE_CLIENT_ID           — from Google Cloud Console OAuth client
//   GOOGLE_CLIENT_SECRET       — from Google Cloud Console OAuth client
//   SUPABASE_URL               — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY  — auto-injected
//   SUPABASE_ANON_KEY          — auto-injected

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON        = Deno.env.get("SUPABASE_ANON_KEY")!;

const GCAL_API      = "https://www.googleapis.com/calendar/v3";
const EVENT_MINUTES = 30; // default block length for a task/order deadline
const WINDOW_PAST_DAYS   = 7;   // don't bother syncing things that were due further back than this
const WINDOW_FUTURE_DAYS = 120; // cap how far ahead the calendar accumulates events

// Bakeri EventColor rawValue → Google Calendar event colorId (Google's fixed 11-color palette).
// Baking tasks don't sync a color from SwiftData (colorName isn't a synced column), so they
// default to "gold". Orders carry color_name and are mapped directly.
const COLOR_MAP: Record<string, string> = {
  red: "11", orange: "6", gold: "5", green: "10", teal: "7",
  blue: "9", purple: "3", pink: "4", brown: "8", indigo: "9",
};
const DEFAULT_TASK_COLOR_ID = COLOR_MAP.gold;

type Mapping = { id: string; google_event_id: string; source_updated_at: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  // ── 1. Verify baker JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  // ── 2. Load the integration, refreshing the access token if it's near expiry ──
  const { data: integration } = await admin
    .from("calendar_integrations")
    .select("access_token,refresh_token,token_expires_at,calendar_id")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .eq("is_active", true)
    .single<{ access_token: string; refresh_token: string | null; token_expires_at: string | null; calendar_id: string }>();

  if (!integration) {
    return new Response(JSON.stringify({ error: "No active Google Calendar integration" }), { status: 404 });
  }

  let accessToken = integration.access_token;
  const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(integration.refresh_token);
    if (!refreshed) {
      return new Response(JSON.stringify({ error: "Google token refresh failed — reconnect required" }), { status: 401 });
    }
    accessToken = refreshed.access_token;
    await admin.from("calendar_integrations").update({
      access_token:     refreshed.access_token,
      token_expires_at: refreshed.expires_at,
      updated_at:       new Date().toISOString(),
    }).eq("user_id", user.id).eq("provider", "google");
  }

  const calendarId = integration.calendar_id;

  // ── 3. Fetch source rows ───────────────────────────────────────────────────────
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_PAST_DAYS * 86_400_000);
  const windowEnd   = new Date(now + WINDOW_FUTURE_DAYS * 86_400_000);
  const inWindow = (d: Date) => d >= windowStart && d <= windowEnd;

  const { data: tasks } = await admin
    .from("baking_tasks")
    .select("id,title,due_date,notes,updated_at")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  const { data: orders } = await admin
    .from("orders")
    .select("id,order_name,customer_name,due_date,scheduled_pickup_date,status,fulfillment_type,delivery_details,color_name,updated_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .not("status", "in", "(cancelled,declined)");

  // ── 4. Load existing sync mappings ─────────────────────────────────────────────
  const { data: mappingRows } = await admin
    .from("calendar_synced_events")
    .select("id,source_type,source_id,google_event_id,source_updated_at")
    .eq("user_id", user.id);

  const mappings = new Map<string, Mapping>();
  for (const m of mappingRows ?? []) {
    mappings.set(`${m.source_type}:${m.source_id}`, m);
  }

  const activeKeys = new Set<string>();
  let pushed = 0;
  let failed = 0;

  // ── 5. Push tasks ───────────────────────────────────────────────────────────────
  for (const t of tasks ?? []) {
    const start = new Date(t.due_date);
    if (!inWindow(start)) continue;
    const key = `baking_task:${t.id}`;
    activeKeys.add(key);

    const existing = mappings.get(key);
    if (existing && new Date(existing.source_updated_at) >= new Date(t.updated_at)) continue;

    const ok = await pushEvent({
      accessToken, calendarId,
      eventId: existing?.google_event_id,
      summary: t.title,
      description: t.notes ? `${t.notes}\n\nSynced from Bakeri` : "Synced from Bakeri",
      start, colorId: DEFAULT_TASK_COLOR_ID,
    });
    if (!ok.eventId) { failed++; continue; }

    await admin.from("calendar_synced_events").upsert({
      user_id: user.id, source_type: "baking_task", source_id: t.id,
      google_event_id: ok.eventId, source_updated_at: t.updated_at,
    }, { onConflict: "user_id,source_type,source_id" });
    pushed++;
  }

  // ── 6. Push orders ───────────────────────────────────────────────────────────────
  for (const o of orders ?? []) {
    const effectiveDate = o.scheduled_pickup_date ?? o.due_date;
    const start = new Date(effectiveDate);
    if (!inWindow(start)) continue;
    const key = `order:${o.id}`;
    activeKeys.add(key);

    const existing = mappings.get(key);
    if (existing && new Date(existing.source_updated_at) >= new Date(o.updated_at)) continue;

    const descLines = [
      `Customer: ${o.customer_name}`,
      o.fulfillment_type ? `Fulfillment: ${o.fulfillment_type}` : null,
      o.delivery_details ? o.delivery_details : null,
      "Synced from Bakeri",
    ].filter(Boolean);

    const ok = await pushEvent({
      accessToken, calendarId,
      eventId: existing?.google_event_id,
      summary: `Order: ${o.order_name}`,
      description: descLines.join("\n"),
      start, colorId: COLOR_MAP[o.color_name] ?? DEFAULT_TASK_COLOR_ID,
    });
    if (!ok.eventId) { failed++; continue; }

    await admin.from("calendar_synced_events").upsert({
      user_id: user.id, source_type: "order", source_id: o.id,
      google_event_id: ok.eventId, source_updated_at: o.updated_at,
    }, { onConflict: "user_id,source_type,source_id" });
    pushed++;
  }

  // ── 7. Delete events for mappings that fell out of the active set ────────────────
  let deleted = 0;
  for (const [key, m] of mappings) {
    if (activeKeys.has(key)) continue;
    await deleteEvent(accessToken, calendarId, m.google_event_id);
    await admin.from("calendar_synced_events").delete().eq("id", m.id);
    deleted++;
  }

  return new Response(JSON.stringify({ pushed, deleted, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string | null): Promise<{ access_token: string; expires_at: string } | null> {
  if (!refreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("Token refresh failed:", await res.text());
    return null;
  }
  const data = await res.json();
  if (!data.access_token) return null;
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  return { access_token: data.access_token, expires_at: expiresAt };
}

async function pushEvent(opts: {
  accessToken: string; calendarId: string; eventId?: string;
  summary: string; description: string; start: Date; colorId: string;
}): Promise<{ eventId?: string }> {
  const end = new Date(opts.start.getTime() + EVENT_MINUTES * 60_000);
  const body = JSON.stringify({
    summary: opts.summary,
    description: opts.description,
    start: { dateTime: opts.start.toISOString() },
    end:   { dateTime: end.toISOString() },
    colorId: opts.colorId,
  });

  const url = opts.eventId
    ? `${GCAL_API}/calendars/${encodeURIComponent(opts.calendarId)}/events/${encodeURIComponent(opts.eventId)}`
    : `${GCAL_API}/calendars/${encodeURIComponent(opts.calendarId)}/events`;

  const res = await fetch(url, {
    method: opts.eventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    console.error("Google event push failed:", res.status, await res.text());
    return {};
  }
  const data = await res.json();
  return { eventId: data.id };
}

async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(
    `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  // 404/410 means it's already gone on Google's side — treat as success either way.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error("Google event delete failed:", res.status, await res.text());
  }
}
