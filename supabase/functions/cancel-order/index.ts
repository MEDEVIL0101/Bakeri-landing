import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { logNotification } from "../_shared/notificationLog.ts";

// As of 20260823000001_physical_order_lifecycle.sql this function serves two
// related but distinct outcomes, branching on the order's status at the time
// of the call:
//  - true cancel (pending/confirmed/ready_for_pickup/out_for_delivery — no
//    fulfillment progress yet): marketplace_status -> 'cancelled'. Buyer
//    notification handled entirely by trg_fn_marketplace_order_notify.
//  - refund (awaiting_shipment/preparing/shipped/delivered — a physical
//    order that's paid and/or in flight): marketplace_status -> 'refunded'.
//    The DB trigger has no 'refunded' branch, so this function owns its own
//    notification, same "function fully owns its notification" pattern as
//    mark-order-shipped/mark-order-delivered.
// The Stripe refund-vs-cancel-hold branch below is identical either way —
// it's keyed on the PaymentIntent's live Stripe status, not on which of the
// two outcomes this call represents.

const SUPABASE_URL               = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY          = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET             = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

const stripe = getStripeClient();

// Same shape as mark-order-shipped/mark-order-delivered's postWithRetry — a
// plain `fetch(...).catch(...)` doesn't catch a non-2xx response.
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
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Auth: baker JWT only (no webhook path — cancel is always baker-initiated)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { order_id }: { order_id: string } = await req.json();
    if (!order_id) throw new Error("order_id is required");

    // Fetch order and verify baker owns it
    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, user_id, order_name, buyer_profile_id, lead_channel, payment_intent_id, payment_status, payment_model, marketplace_status")
      .eq("id", order_id)
      .single();

    if (fetchErr || !order) throw new Error("Order not found");
    if (order.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }

    // Only allow cancel/refund on active-or-in-flight orders
    const cancelableStatuses = ["pending", "confirmed", "ready_for_pickup", "out_for_delivery"];
    const refundableStatuses = ["awaiting_shipment", "preparing", "shipped", "delivered"];
    if (![...cancelableStatuses, ...refundableStatuses].includes(order.marketplace_status ?? "")) {
      throw new Error(`Cannot cancel/refund an order with status: ${order.marketplace_status}`);
    }
    const isRefund = refundableStatuses.includes(order.marketplace_status ?? "");

    // Cancel or refund via Stripe.
    // Skip entirely for mock/test payment intents (no real charge was made).
    const isMockIntent = (order.payment_intent_id ?? "").startsWith("mock_");

    if (order.payment_intent_id && !isMockIntent) {
      // A direct-charge order's PaymentIntent lives on the baker's own
      // connected account (order.user_id === user.id here, since only the
      // owning baker can cancel) — every Stripe call below must target it.
      let stripeOpts: { stripeAccount: string } | undefined;
      if (order.payment_model === "direct") {
        const { data: baker } = await supabase
          .from("profiles")
          .select("stripe_connect_account_id, stripe_connect_express_account_id_legacy")
          .eq("id", order.user_id)
          .single();
        // Falls back to the pre-migration Express id if the baker has
        // disconnected/reconnected since this order was charged (e.g. mid
        // Express->Standard cutover) — stripe_connect_account_id alone would
        // point at a different account than the one this PaymentIntent
        // actually lives on.
        const acctId = baker?.stripe_connect_account_id ?? baker?.stripe_connect_express_account_id_legacy;
        if (acctId) {
          stripeOpts = { stripeAccount: acctId };
        }
      }

      // Branch on Stripe's own live PaymentIntent status, never the local
      // payment_status label — that field is an internal bookkeeping
      // convention (e.g. ready-now orders stay "authorized" until pickup
      // even after Stripe has actually captured), not a mirror of Stripe's
      // real state. Trusting it here previously meant cancelling an
      // order whose card had genuinely already been charged tried to
      // *cancel* an already-captured PaymentIntent — Stripe rejects that
      // with payment_intent_unexpected_state (an ignored/expected code),
      // so nothing was refunded even though the DB was marked "refunded".
      // See refund-and-notify-guest-order-declined, which already does this
      // correctly.
      let intent;
      try {
        intent = await stripe.paymentIntents.retrieve(order.payment_intent_id, stripeOpts);
      } catch {
        throw new Error("Could not verify payment status before cancelling.");
      }

      if (intent.status === "succeeded") {
        // Already captured — issue a full refund. refund_application_fee
        // reverses Bakeri's own platform-fee cut back to the baker's
        // connected account too — otherwise a fully-refunded order left the
        // baker short by Bakeri's fee on top of Stripe's own (never-
        // refundable) processing fee, i.e. Bakeri profited on sales that
        // never happened. Only meaningful on a direct charge (stripeOpts
        // set) — platform_custody orders have no application fee to reverse.
        try {
          await stripe.refunds.create(
            { payment_intent: order.payment_intent_id, refund_application_fee: !!stripeOpts },
            stripeOpts
          );
        } catch (err: unknown) {
          // resource_missing = intent doesn't exist (was already voided), nothing to refund
          // charge_already_refunded = a previous attempt already succeeded
          // deno-lint-ignore no-explicit-any
          const code = (err as any)?.code ?? (err as any)?.raw?.code;
          const ignoredCodes = ["resource_missing", "charge_already_refunded"];
          if (!ignoredCodes.includes(code)) {
            throw new Error(err instanceof Error ? err.message : "Stripe refund failed");
          }
        }
      } else {
        // Never actually captured (requires_capture, or already canceled) —
        // cancel the hold. No money to refund.
        try {
          await stripe.paymentIntents.cancel(order.payment_intent_id, stripeOpts);
        } catch (err: unknown) {
          // unexpected_state = already cancelled; resource_missing = doesn't exist
          // deno-lint-ignore no-explicit-any
          const code = (err as any)?.code ?? (err as any)?.raw?.code;
          const ignoredCodes = ["payment_intent_unexpected_state", "resource_missing"];
          if (!ignoredCodes.includes(code)) {
            throw new Error(err instanceof Error ? err.message : "Stripe cancel failed");
          }
        }
      }
    }

    // Update the order to cancelled or refunded
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("orders")
      .update(
        isRefund
          ? { marketplace_status: "refunded", refunded_at: nowIso, payment_status: "refunded", updated_at: nowIso }
          : { marketplace_status: "cancelled", status: "cancelled", payment_status: "refunded", updated_at: nowIso }
      )
      .eq("id", order_id);

    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    // Post a system message so the buyer sees an explanation in the thread
    const { error: msgErr } = await supabase
      .from("order_messages")
      .insert({
        order_id,
        sender_profile_id: user.id,
        message: isRefund
          ? "Baker refunded this order. A full refund has been issued to your payment method."
          : "Baker cancelled this order. A full refund has been issued to your payment method.",
      });

    if (msgErr) console.error("Failed to insert cancel message:", msgErr.message);

    let notified = true;

    if (isRefund) {
      // The DB trigger (trg_fn_marketplace_order_notify) has no 'refunded'
      // branch, unlike 'cancelled' — this function must own its own
      // notification, same pattern as mark-order-shipped/mark-order-delivered.
      if (order.buyer_profile_id) {
        const result = await postWithRetry(`${SUPABASE_URL}/functions/v1/notify-marketplace`, {
          recipient_user_id: order.buyer_profile_id,
          title: "Order Refunded",
          body: `${order.order_name ?? "Your order"} has been refunded.`,
          data: { type: "order_refunded", order_id },
        });
        if (!result.ok) {
          notified = false;
          await logNotification(supabase, order_id, "order_refunded", "failed", result.error, "push");
        }
      }
      if (!order.buyer_profile_id && order.lead_channel === "website") {
        const result = await postWithRetry(`${SUPABASE_URL}/functions/v1/send-guest-order-refunded-email`, {
          order_id,
        });
        if (!result.ok) {
          notified = false;
          await logNotification(supabase, order_id, "guest_order_refunded", "failed", result.error, "email");
        }
      }
    }
    // Buyer/baker notification for the true-cancel path is handled by
    // trg_fn_marketplace_order_notify on the marketplace_status update above
    // — it fires as this function's service-role client (auth.uid() IS NULL
    // there), so it correctly attributes the cancellation to the baker and
    // notifies the buyer, not the other way around. Do not duplicate that
    // push here.

    return new Response(JSON.stringify({ success: true, notified }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
