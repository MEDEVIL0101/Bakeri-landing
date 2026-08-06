// google-calendar-oauth-callback
// Receives the OAuth redirect from Google, exchanges the code for tokens,
// creates a dedicated "Bakeri Schedule" calendar, stores everything in
// calendar_integrations, then redirects to the bakeri:// deep link.
// Mirrors square-oauth-callback.
//
// The `state` param is signed by google-calendar-oauth-start and verified below —
// Google just echoes back whatever we sent it, so without verification anyone
// could craft their own authorize URL with state=bakeri:{victim UUID} and link
// their own Google account to someone else's Bakeri account.
//
// Required env vars (set via `supabase secrets set`):
//   GOOGLE_CLIENT_ID           — from Google Cloud Console OAuth client
//   GOOGLE_CLIENT_SECRET       — from Google Cloud Console OAuth client
//   GOOGLE_OAUTH_STATE_SECRET  — must match the one google-calendar-oauth-start signs with
//   SUPABASE_URL               — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY  — auto-injected by Supabase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyState } from "../_shared/google-oauth-state.ts";

const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-oauth-callback`;

const deepLink = (path: string) =>
  new Response(null, { status: 302, headers: { Location: `bakeri://calendar/google/${path}` } });

Deno.serve(async (req: Request) => {
  const url   = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // "{userId}.{expiresAt}.{signature}"
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    console.error("OAuth error or missing params:", { error, hasCode: !!code, hasState: !!state });
    return deepLink("failed");
  }

  const userId = await verifyState(state);
  if (!userId) {
    console.error("OAuth state failed verification (invalid, expired, or tampered)");
    return deepLink("failed");
  }

  // ── 1. Exchange code for tokens ──────────────────────────────────────────────
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type:    "authorization_code",
      redirect_uri:  REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    return deepLink("failed");
  }

  const tokens = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokens;

  if (!access_token) {
    console.error("Missing access_token:", tokens);
    return deepLink("failed");
  }
  if (!refresh_token) {
    // Happens if the baker previously connected and Google didn't re-issue one
    // despite prompt=consent (rare, but possible on some account types). Without
    // a refresh_token, sync will silently stop working once the access token
    // expires (~1hr), so treat this as a failure and have them reconnect.
    console.error("Missing refresh_token — baker must fully reconnect");
    return deepLink("failed");
  }

  const expiresAt = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

  // ── 2. Fetch account email for display ────────────────────────────────────────
  let accountEmail = "";
  try {
    const uRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (uRes.ok) {
      const uData = await uRes.json();
      accountEmail = uData.email ?? "";
    }
  } catch (_) { /* non-fatal */ }

  // ── 3. Create the dedicated "Bakeri Schedule" calendar ────────────────────────
  const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: "Bakeri Schedule" }),
  });

  if (!calRes.ok) {
    console.error("Calendar creation failed:", await calRes.text());
    return deepLink("failed");
  }
  const calData = await calRes.json();
  const calendarId = calData.id;
  if (!calendarId) {
    console.error("Missing calendar id:", calData);
    return deepLink("failed");
  }

  // ── 4. Upsert into calendar_integrations ─────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
  const { error: dbErr } = await supabase
    .from("calendar_integrations")
    .upsert(
      {
        user_id:          userId,
        provider:         "google",
        access_token,
        refresh_token,
        token_expires_at: expiresAt,
        calendar_id:      calendarId,
        account_email:    accountEmail,
        is_active:        true,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (dbErr) {
    console.error("DB upsert failed:", dbErr);
    return deepLink("failed");
  }

  const encodedEmail = encodeURIComponent(accountEmail);
  return deepLink(`connected?account=${encodedEmail}`);
});
