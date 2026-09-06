import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { logNotification } from "../_shared/notificationLog.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";

// Trigger-invoked (x-webhook-secret, not a JWT) by
// call_guest_order_webhook() in the pending→confirmed branch of
// trg_fn_marketplace_order_notify (20260714000009_web_checkout.sql) —
// never called directly by the client. The baker has now accepted a real
// paid order, so this is the one place allowed to read pickup_address for
// a guest order. When QR_PICKUP_VERIFICATION_ENABLED is on, encodes the raw
// order UUID as a QR — same payload OrderQRCodeView.swift shows in-app, so
// the baker's existing scanner (MarketplaceOrderSheet.handleQRScan ->
// authorize_pickup) works unmodified. Currently off — see that constant.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

// Mirrors MarketplaceAvailability.qrPickupVerificationEnabled (Deno can't
// import that Swift file directly, so kept in sync by name/value here).
// Paused 2026-08-04 — a real guest order's QR image never rendered in this
// email, and the baker had no way to complete the handoff at all. Flip
// back on together with the Swift flag once QR verification returns for
// the marketplace relaunch.
const QR_PICKUP_VERIFICATION_ENABLED = false;

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
    .select("id, order_name, customer_name, customer_email, baker_display_name, user_id, scheduled_pickup_date")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    await logNotification(db, orderId, "guest_order_confirmed", "failed", orderErr?.message ?? "order not found or missing customer_email");
    return json({ error: "Order not found." }, 400);
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("pickup_address, pickup_city, pickup_province")
    .eq("id", order.user_id)
    .single();

  const { data: items } = await db
    .from("order_items")
    .select("custom_name, quantity, price_per_unit, variant_breakdown, preorder_date")
    .eq("order_id", orderId)
    .is("deleted_at", null);

  const itemRows = (items ?? [])
    .map((i) => {
      const breakdown = Array.isArray(i.variant_breakdown)
        ? (i.variant_breakdown as { name: string; quantity: number }[])
            .map((v) => `${v.quantity}× ${escapeHtml(v.name)}`).join(", ")
        : "";
      // A single order can hold several preorder lines for the same item on
      // different dates (buyer picked more than one candidate date at
      // checkout) — this is the only per-line indicator of which date each
      // line is for, since the order-level pickupLine below only shows the
      // earliest date across the whole order.
      const readyLine = i.preorder_date
        ? `Ready ${new Date(i.preorder_date as string).toLocaleDateString(undefined, { dateStyle: "medium" })}`
        : "";
      return `<tr><td style="padding:6px 0;">${i.quantity}× ${escapeHtml(i.custom_name)}` +
        (breakdown ? `<div style="color:#A89B8C;font-size:12px;">${breakdown}</div>` : "") +
        (readyLine ? `<div style="color:#A89B8C;font-size:12px;">${readyLine}</div>` : "") +
        `</td><td style="padding:6px 0;text-align:right;">$${(i.price_per_unit * i.quantity).toFixed(2)}</td></tr>`;
    })
    .join("");

  const qrDataUri = QR_PICKUP_VERIFICATION_ENABLED
    ? await QRCode.toDataURL(orderId, { width: 240, margin: 1 })
    : null;

  const addressLine = [bakerProfile?.pickup_address, bakerProfile?.pickup_city, bakerProfile?.pickup_province]
    .filter(Boolean)
    .join(", ");
  const pickupLine = order.scheduled_pickup_date
    ? `Ready for pickup: ${new Date(order.scheduled_pickup_date as string).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}`
    : "Ready for pickup as soon as possible — the baker will let you know.";

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">🎉 Your order is confirmed!</h2>
      <p style="color:#6B5F54;line-height:1.5;">
        ${escapeHtml(order.baker_display_name || "The baker")} accepted your order for
        ${escapeHtml(order.order_name || "your order")}.
      </p>
      ${qrDataUri ? `<div style="text-align:center;margin:24px 0;">
        <img src="${qrDataUri}" alt="Pickup QR code" width="200" height="200" />
      </div>` : ""}
      <p style="line-height:1.5;"><strong>${escapeHtml(pickupLine)}</strong></p>
      ${addressLine ? `<p style="line-height:1.5;">📍 ${escapeHtml(addressLine)}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;margin-top:16px;border-top:1px solid #E8E4DC;padding-top:12px;">
        ${itemRows}
      </table>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin-top:20px;">
        Need to change something, or have a question about pickup? Just reply to this
        email — it reaches ${escapeHtml(order.baker_display_name || "your baker")} directly.
      </p>
    </div>
  `;

  const identity = await customerEmailIdentity(db, order.user_id, order.baker_display_name);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: identity.from,
      reply_to: identity.reply_to,
      to: order.customer_email,
      subject: `Order confirmed — ${order.order_name || "your order"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend send failed:", errText);
    await logNotification(db, orderId, "guest_order_confirmed", "failed", errText.slice(0, 500));
  } else {
    await logNotification(db, orderId, "guest_order_confirmed", "sent");
  }

  return json({ ok: true });
});
