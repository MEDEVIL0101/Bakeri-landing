import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";

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
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// A plain `fetch(...).catch(...)` here doesn't actually catch anything
// useful: fetch only rejects on a network-level failure, never on a non-2xx
// response — so a downstream function returning a 400/500 looked identical
// to success from here, and the customer's notification email silently
// never sent. Checks the actual response status either way, with a few
// retries for genuinely transient failures.
//
// send-guest-order-ready-email keeps Supabase's platform-level JWT
// verification ON (verify_jwt: true) by design — the same pattern as
// send-guest-order-confirmed-email / refund-and-notify-guest-order-declined
// / expire-overdue-guest-orders, see 20260714000012_guest_webhook_calls_add_apikey.sql,
// which documents that every caller of one of these functions must add the
// public anon key as `apikey`/`Authorization` headers to satisfy the
// platform gate, on top of the function's own real access control
// (x-webhook-secret). This function never did that — confirmed live
// 2026-08-08 via notification_log, which started recording
// `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` on every single attempt, not an
// intermittent one, once a project-level key rotation made the platform
// gate start strictly enforcing it. Not a cold-start/timeout issue as
// originally guessed earlier the same day — this call was missing required
// headers from the day this function was written.
async function postWithRetry(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  let lastError = "unknown error";
  const delaysMs = [0, 600, 1400, 2600];
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "x-webhook-secret": WEBHOOK_SECRET,
        },
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
    const body = await req.json() as {
      order_id: string;
      pickup_date?: string;   // ISO date/timestamp — the day. Required unless resend_only.
      window_start?: string;  // display string, e.g. "3:00 PM". Required unless resend_only.
      window_end?: string;
      // Resend the existing ready-for-pickup notification as-is — no date/
      // window change. Deliberately takes no pickup_date/window_start/
      // window_end from the client at all (not just ignores them): the
      // baker's app can only ever have this order's own sheet open when
      // this fires, but confirmed live 2026-08-08 that the sheet's cached
      // pickup-time state can still end up stale/wrong (exact mechanism
      // unconfirmed — possibly SwiftUI view/state reuse across a prior
      // order's sheet). Reading straight from the DB below instead of
      // trusting anything client-supplied means a resend can never
      // overwrite a correct saved pickup time with a wrong one, regardless
      // of what caused that staleness client-side.
      resend_only?: boolean;
    };
    const { order_id, resend_only } = body;
    if (!order_id) throw new Error("Missing order_id");
    if (!resend_only && (!body.pickup_date || !body.window_start || !body.window_end)) {
      throw new Error("Missing pickup_date, window_start, or window_end");
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, order_name, marketplace_status, buyer_profile_id, buyer_display_name, lead_channel, baker_display_name, scheduled_pickup_date, pickup_window_start, pickup_window_end")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (order.user_id !== user.id) throw new Error("Forbidden");

    let pickup_date: string;
    let window_start: string;
    let window_end: string;
    let isReschedule: boolean;

    if (resend_only) {
      if (order.marketplace_status !== "ready_for_pickup") {
        throw new Error(`Cannot resend — order is not ready for pickup (status: ${order.marketplace_status})`);
      }
      if (!order.scheduled_pickup_date || !order.pickup_window_start || !order.pickup_window_end) {
        // A `code` alongside the message so the app can offer the baker a
        // way to actually fix this (open the set-pickup-time sheet) instead
        // of just showing a dead-end error — confirmed live 2026-08-08 that
        // a resend can land on an order with no pickup time saved (data
        // repaired after a local-cache resurrection lost it; could also
        // happen from any other future data gap).
        return json({ error: "No pickup time saved on this order to resend.", code: "no_pickup_time" }, 400);
      }
      pickup_date = order.scheduled_pickup_date;
      window_start = order.pickup_window_start;
      window_end = order.pickup_window_end;
      // Always the original "ready for pickup" framing, never "time
      // updated" — nothing actually changed, this is a pure resend.
      isReschedule = false;
      // No orders UPDATE at all in this branch — a resend reads and
      // notifies only, it never writes.
    } else {
      const cancelableForReady = ["pending", "confirmed", "ready_for_pickup"];
      if (!cancelableForReady.includes(order.marketplace_status ?? "")) {
        throw new Error(`Cannot mark ready from status: ${order.marketplace_status}`);
      }
      isReschedule = order.marketplace_status === "ready_for_pickup";
      pickup_date = body.pickup_date!;
      window_start = body.window_start!;
      window_end = body.window_end!;

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
    }

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
        // Logged here (not just inside notify-marketplace) so a failure that
        // never got a completed response — the exact "zero trace anywhere"
        // gap confirmed live 2026-08-08 — still shows up somewhere durable.
        await logNotification(
          supabase, order_id, isReschedule ? "pickup_rescheduled" : "ready_for_pickup",
          "failed", result.error, "push"
        );
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
        // send-guest-order-ready-email logs its own failures too, but only
        // when a request actually reaches its try/catch — a fetch-level
        // failure (never got a response) skips that entirely, so log it here
        // as a backstop regardless of which layer the failure happened at.
        await logNotification(supabase, order_id, "guest_order_ready", "failed", result.error, "email");
      }
    }

    // Any save above (skipped entirely for resend_only) already succeeded
    // and stands regardless — `notified: false` just tells the baker the
    // customer may not know yet, so they can follow up directly (their
    // contact info is already on the order) rather than assuming the
    // notification landed.
    return json({ ok: true, is_reschedule: isReschedule, notified });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 400);
  }
});
