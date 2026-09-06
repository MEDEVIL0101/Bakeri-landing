import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";

// Called directly by baker/checkout.html right after
// create-guest-marketplace-order succeeds. Immediate "payment processed,
// awaiting baker confirmation" email — deliberately no QR code and no
// pickup address here, since the baker hasn't accepted the order yet.
// Those go out separately by send-guest-order-confirmed-email once they do.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
    .select("id, order_name, customer_name, customer_email, baker_display_name, user_id")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    await logNotification(db, orderId, "guest_order_received", "failed", orderErr?.message ?? "order not found or missing customer_email");
    return json({ error: "Order not found." }, 400);
  }

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
      // line is for.
      const readyLine = i.preorder_date
        ? `Ready ${new Date(i.preorder_date as string).toLocaleDateString(undefined, { dateStyle: "medium" })}`
        : "";
      return `<tr><td style="padding:6px 0;">${i.quantity}× ${escapeHtml(i.custom_name)}` +
        (breakdown ? `<div style="color:#A89B8C;font-size:12px;">${breakdown}</div>` : "") +
        (readyLine ? `<div style="color:#A89B8C;font-size:12px;">${readyLine}</div>` : "") +
        `</td><td style="padding:6px 0;text-align:right;">$${(i.price_per_unit * i.quantity).toFixed(2)}</td></tr>`;
    })
    .join("");

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Payment processed</h2>
      <p style="color:#6B5F54;line-height:1.5;">
        ${escapeHtml(order.baker_display_name || "The baker")} is reviewing your order for
        ${escapeHtml(order.order_name || "your order")}. You'll get another email as soon as
        it's confirmed.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;border-top:1px solid #E8E4DC;padding-top:12px;">
        ${itemRows}
      </table>
      <p style="color:#A89B8C;font-size:12px;margin-top:24px;">Order reference: ${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}</p>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin-top:12px;">
        Questions about this order? Just reply to this email — it reaches
        ${escapeHtml(order.baker_display_name || "your baker")} directly.
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
      subject: `Payment received — ${order.order_name || "your order"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend send failed:", errText);
    await logNotification(db, orderId, "guest_order_received", "failed", errText.slice(0, 500));
  } else {
    await logNotification(db, orderId, "guest_order_received", "sent");
  }

  return json({ ok: true });
});

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
