import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Baker-triggered: the "Mark Ready for Pickup" / "Change Pickup Time" sheet
// in MarketplaceOrderSheet.swift. Owns the whole notification for this
// transition itself (push + guest email) rather than going through
// trg_fn_marketplace_order_notify's generic ready_for_pickup branch (removed
// 2026-08-07, see 20260807000008_remove_trigger_ready_for_pickup.sql) —
// unlike every other status transition, this one needs to carry a specific
// date/time window the trigger has no way to know about, and needs to fire
// again on a plain reschedule (same status, different time), which the
// trigger's "only on a status change" guard can never do.
//
// A raw client-side table update (the old markReadyForPickup()) is no
// longer enough: this is the only place that sets marketplace_status =
// 'ready_for_pickup' going forward, so every path (first mark-ready,
// reschedule, and the ready-now accept-and-fulfil flow) goes through the
// same notification logic.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const { order_id, pickup_date, window_start, window_end } = await req.json() as {
      order_id: string;
      pickup_date: string;   // ISO date/timestamp — the day
      window_start: string;  // display string, e.g. "3:00 PM"
      window_end: string;
    };
    if (!order_id || !pickup_date || !window_start || !window_end) {
      throw new Error("Missing order_id, pickup_date, window_start, or window_end");
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, order_name, marketplace_status, buyer_profile_id, buyer_display_name, lead_channel, baker_display_name")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (order.user_id !== user.id) throw new Error("Forbidden");

    const cancelableForReady = ["pending", "confirmed", "ready_for_pickup"];
    if (!cancelableForReady.includes(order.marketplace_status ?? "")) {
      throw new Error(`Cannot mark ready from status: ${order.marketplace_status}`);
    }
    const isReschedule = order.marketplace_status === "ready_for_pickup";

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        marketplace_status: "ready_for_pickup",
        scheduled_pickup_date: pickup_date,
        pickup_window_start: window_start,
        pickup_window_end: window_end,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order_id);
    if (updateErr) throw new Error(updateErr.message);

    const { data: baker } = await supabase
      .from("profiles")
      .select("business_name, user_name")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || order.baker_display_name || "Your baker";

    const dateStr = new Date(pickup_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const windowStr = `${window_start}–${window_end}`;

    // Push (in-app buyer)
    if (order.buyer_profile_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-marketplace`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
          body: JSON.stringify({
            recipient_user_id: order.buyer_profile_id,
            title: isReschedule ? "Pickup time updated" : "🛍️ Ready for Pickup!",
            body: `${order.order_name || "Your order"} from ${bakerName} — ${dateStr}, ${windowStr}`,
            data: { type: isReschedule ? "pickup_rescheduled" : "ready_for_pickup", order_id },
          }),
        });
      } catch (err) {
        console.error("notify-marketplace push failed:", err);
      }
    }

    // Email (guest)
    if (!order.buyer_profile_id && order.lead_channel === "website") {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-guest-order-ready-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
          body: JSON.stringify({ order_id, is_reschedule: isReschedule }),
        });
      } catch (err) {
        console.error("send-guest-order-ready-email failed:", err);
      }
    }

    return json({ ok: true, is_reschedule: isReschedule });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 400);
  }
});
