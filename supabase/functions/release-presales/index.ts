// Pre-sales (migration 20261110000002): sends each pre-sale download / course
// link once its release date arrives. Runs daily, 9am ET (pg_cron "release-presales").
// Finds order lines with presale_release_at passed and no presale_delivered_at,
// asks resend-digital-download to email that order's links (it now releases
// those lines), and marks them delivered. Secret-gated like the other crons.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) return json({ error: "Unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  const { data: due, error } = await db.from("order_items")
    .select("id, order_id")
    .not("presale_release_at", "is", null)
    .lte("presale_release_at", now)
    .is("presale_delivered_at", null)
    .is("deleted_at", null)
    .limit(500);
  if (error) { console.error("release-presales lookup:", error.message); return json({ error: error.message }, 500); }

  const byOrder = new Map<string, string[]>();
  (due ?? []).forEach((l) => byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l.id]));

  let sent = 0, failed = 0;
  for (const [orderId, lineIds] of byOrder) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resend-digital-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ order_id: orderId, send_email: true }),
    }).catch((e) => { console.error("resend call failed:", orderId, e); return null; });
    const body = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || body?.error) {
      console.error("release failed:", orderId, res?.status, JSON.stringify(body));
      failed++;
      continue;   // retried tomorrow
    }
    await db.from("order_items").update({ presale_delivered_at: now }).in("id", lineIds);
    sent++;
  }
  // Courses / clubs that just opened: email the link to members who joined
  // without an order (club subscriptions, students added by hand) — buyers with
  // an order got theirs above. Once per release date (presale_announced_for).
  const { data: opened } = await db.from("menu_items")
    .select("id, presale_release_at, presale_announced_for")
    .eq("is_course", true).is("deleted_at", null)
    .not("presale_release_at", "is", null).lte("presale_release_at", now)
    // Only dates that just passed — a date set in the past never mass-emails anyone.
    .gte("presale_release_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString())
    .limit(100);
  let announced = 0;
  for (const m of (opened ?? []).filter((m) => m.presale_announced_for !== m.presale_release_at)) {
    const { data: members } = await db.from("course_enrollments")
      .select("email").eq("menu_item_id", m.id).is("order_id", null).is("revoked_at", null);
    for (const e of members ?? []) {
      await fetch(`${SUPABASE_URL}/functions/v1/course-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ menu_item_id: m.id, email: e.email, resend: true }),
      }).catch((err) => console.error("opening email failed:", m.id, err));
      announced++;
    }
    await db.from("menu_items").update({ presale_announced_for: m.presale_release_at }).eq("id", m.id);
  }
  return json({ orders: byOrder.size, sent, failed, announced });
});
