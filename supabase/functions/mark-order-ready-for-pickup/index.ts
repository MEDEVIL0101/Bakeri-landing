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

// A plain `fetch(...).catch(...)` here doesn't actually catch anything
// useful: fetch only rejects on a network-level failure, never on a non-2xx
// response — so a downstream function returning a 400/500 (confirmed live
// 2026-08-07: an unhandled error inside send-guest-order-ready-email) looked
// identical to success from here, and the customer's "pickup time changed"
// email silently never sent. Three attempts with a short delay between them
// for genuinely transient failures (confirmed live 2026-08-08: a baker's
// attempt failed twice back-to-back with zero delay, immediately after this
// function's own redeploy — most likely both landed inside the same brief
// deploy-propagation window; a manual re-test moments later succeeded on the
// first try with no code changes) — checks the actual response status either way.
async function postWithRetry(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  let lastError = "unknown error";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      lastError = (await res.text()).slice(0, 500);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
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

    // Same "read a stored calendar-day timestamptz back as UTC" rule as
    // send-guest-order-ready-email — without it this string (and the push
    // notification body built from it) can land on the wrong day for
    // anyone west of UTC.
    const dateStr = new Date(pickup_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    const windowStr = `${window_start}–${window_end}`;

    let notified = true;

    // Push (in-app buyer)
    if (order.buyer_profile_id) {
      const result = await postWithRetry(`${SUPABASE_URL}/functions/v1/notify-marketplace`, {
        recipient_user_id: order.buyer_profile_id,
        title: isReschedule ? "Pickup time updated" : "🛍️ Ready for Pickup!",
        body: `${order.order_name || "Your order"} from ${bakerName} — ${dateStr}, ${windowStr}`,
        data: { type: isReschedule ? "pickup_rescheduled" : "ready_for_pickup", order_id },
      });
      if (!result.ok) {
        console.error(`notify-marketplace push failed for order ${order_id}:`, result.error);
        notified = false;
      }
    }

    // Email (guest)
    if (!order.buyer_profile_id && order.lead_channel === "website") {
      const result = await postWithRetry(`${SUPABASE_URL}/functions/v1/send-guest-order-ready-email`, {
        order_id,
        is_reschedule: isReschedule,
      });
      if (!result.ok) {
        console.error(`send-guest-order-ready-email failed for order ${order_id}:`, result.error);
        notified = false;
      }
    }

    // The date/window update above already succeeded and stands regardless
    // — `notified: false` just tells the baker the customer may not know
    // yet, so they can follow up directly (their contact info is already on
    // the order) rather than assuming the notification landed.
    return json({ ok: true, is_reschedule: isReschedule, notified });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 400);
  }
});
