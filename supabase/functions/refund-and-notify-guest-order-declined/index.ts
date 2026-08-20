import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { logNotification } from "../_shared/notificationLog.ts";

// Trigger-invoked (x-webhook-secret, not a JWT) by call_guest_order_webhook()
// in the →declined branch of trg_fn_marketplace_order_notify
// (20260714000009_web_checkout.sql) — fires whether the baker explicitly
// declined the order in-app, or expire-overdue-guest-orders auto-declined
// it after the response window. Same trigger branch, same function, either
// way — no duplicated refund logic.
//
// Deliberately does NOT reuse cancel-order's payment_status === "captured"
// DB-field check to decide refund-vs-cancel. create-payment-intent always
// uses capture_method: "automatic", so by the time a guest order exists at
// all the PaymentIntent is already genuinely `succeeded` at Stripe — but
// create-guest-marketplace-order records payment_status: "authorized" to
// match create-marketplace-orders's own convention for this flow (a
// general "checkout succeeded" label in this codebase, not a literal
// Stripe capture-state mirror). Trusting that field here would risk
// calling Stripe's *cancel* endpoint on an already-succeeded intent —
// which fails quietly — while still marking the DB "refunded" with no
// money actually having moved. So: re-fetch the PaymentIntent's live
// status from Stripe and branch on that instead.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

const stripe = getStripeClient();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, user_id, order_name, customer_email, customer_name, baker_display_name, payment_intent_id, payment_status, payment_model, decline_message")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    console.error("order lookup failed:", orderErr?.message);
    return json({ error: "Order not found." }, 400);
  }

  // Idempotent — a duplicate trigger fire (or a manual re-run) shouldn't
  // attempt a second refund.
  if (order.payment_status === "refunded") {
    return json({ ok: true, already_refunded: true });
  }

  let refunded = false;

  if (order.payment_intent_id) {
    // A direct-charge order's PaymentIntent lives on the baker's own
    // connected account — every Stripe call below must target it.
    let stripeOpts: { stripeAccount: string } | undefined;
    if (order.payment_model === "direct") {
      const { data: baker } = await db
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", order.user_id)
        .single();
      if (baker?.stripe_connect_account_id) {
        stripeOpts = { stripeAccount: baker.stripe_connect_account_id };
      }
    }

    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(order.payment_intent_id, stripeOpts);
    } catch (err) {
      console.error("Could not fetch PaymentIntent for refund decision:", err);
    }

    if (intent) {
      if (intent.status === "succeeded") {
        try {
          await stripe.refunds.create({ payment_intent: order.payment_intent_id }, stripeOpts);
          refunded = true;
        } catch (err: unknown) {
          // deno-lint-ignore no-explicit-any
          const code = (err as any)?.code ?? (err as any)?.raw?.code;
          if (code === "charge_already_refunded") {
            refunded = true;
          } else {
            console.error("Stripe refund failed:", err instanceof Error ? err.message : err);
          }
        }
      } else {
        // Never actually captured (e.g. requires_capture, or already
        // canceled) — cancel the intent instead. No money to refund.
        try {
          await stripe.paymentIntents.cancel(order.payment_intent_id, stripeOpts);
        } catch (err: unknown) {
          // deno-lint-ignore no-explicit-any
          const code = (err as any)?.code ?? (err as any)?.raw?.code;
          const ignoredCodes = ["payment_intent_unexpected_state", "resource_missing"];
          if (!ignoredCodes.includes(code)) {
            console.error("Stripe cancel failed:", err instanceof Error ? err.message : err);
          }
        }
        refunded = true; // nothing was ever charged
      }
    }
  }

  const hadPayment = Boolean(order.payment_intent_id);

  // Only record "refunded" once we've actually confirmed there's nothing
  // outstanding — either there was never a payment to begin with, or the
  // refund/cancel above genuinely ran. If a payment_intent_id existed but
  // the Stripe lookup itself failed (wrong mode, deleted intent, network
  // error), `intent` above was never fetched and nothing was ever
  // refunded/canceled — writing "refunded" here anyway would silently
  // claim money was handled when it was never even checked. Leave
  // payment_status untouched and log it for manual review instead.
  if (!hadPayment || refunded) {
    await db
      .from("orders")
      .update({ payment_status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", orderId);
  } else {
    console.error(
      `Could not verify refund/cancel for order ${orderId} (payment_intent_id=${order.payment_intent_id}) — leaving payment_status untouched for manual review.`
    );
    await logNotification(
      db,
      orderId,
      "guest_order_declined_refund_check",
      "failed",
      `Could not fetch PaymentIntent ${order.payment_intent_id} to refund/cancel it.`
    );
  }
  const paymentLine = !hadPayment
    ? "No payment was ever taken for this request, so there's nothing to refund."
    : refunded
      ? "You have been fully refunded."
      : "We're processing your refund — contact us if you don't see it within a few business days.";

  const firstName = (order.customer_name ?? "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";

  const noteBlock = order.decline_message
    ? `<p style="line-height:1.5;color:#241712;background:#F7F2E9;border-radius:10px;padding:12px 16px;margin:16px 0;"><em>"${escapeHtml(order.decline_message)}"</em></p>`
    : "";

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Order update</h2>
      <p style="line-height:1.5;">${greeting}</p>
      <p style="color:#6B5F54;line-height:1.5;">
        ${escapeHtml(order.baker_display_name || "The baker")} isn't able to fulfil your order for
        ${escapeHtml(order.order_name || "your order")}. ${paymentLine}
      </p>
      ${noteBlock}
    </div>
  `;

  if (order.customer_email) {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Bakerï <hello@bakeriapp.com>",
        to: order.customer_email,
        subject: `Order update — ${order.order_name || "your order"}`,
        html,
      }),
    });
    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Resend send failed:", errText);
      await logNotification(db, orderId, "guest_order_declined", "failed", errText.slice(0, 500));
    } else {
      await logNotification(db, orderId, "guest_order_declined", "sent");
    }
  }

  return json({ ok: true, refunded });
});
