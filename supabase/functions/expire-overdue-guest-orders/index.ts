import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Cron-invoked (x-webhook-secret) every 5 minutes by the
// expire-overdue-guest-orders pg_cron job
// (20260714000010_expire_guest_orders_cron.sql). Flips any guest order the
// baker never responded to within its window (15min ready_now / 24h
// pre-order) to 'declined' via a single atomic RPC — the actual refund +
// email is handled by refund-and-notify-guest-order-declined, triggered
// off that same status write by trg_fn_marketplace_order_notify
// (20260714000009_web_checkout.sql). This function does nothing else.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db.rpc("expire_overdue_guest_orders");

  if (error) {
    console.error("expire_overdue_guest_orders failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(JSON.stringify({ expired_count: (data ?? []).length }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
