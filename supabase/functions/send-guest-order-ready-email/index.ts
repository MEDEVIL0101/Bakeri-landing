import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";

// Trigger-invoked (x-webhook-secret, not a JWT) by
// call_guest_order_webhook() in the ready_for_pickup branch of
// trg_fn_marketplace_order_notify — never called directly by the client.
// Mirrors send-guest-order-confirmed-email's structure (same pickup-address
// read, same QR payload) since the order was already accepted at this point.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

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
    .select("id, order_name, customer_name, customer_email, baker_display_name, user_id")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    return json({ error: "Order not found." }, 400);
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("pickup_address, pickup_city, pickup_province")
    .eq("id", order.user_id)
    .single();

  const qrDataUri = await QRCode.toDataURL(orderId, { width: 240, margin: 1 });
  const shortCode = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();

  const addressLine = [bakerProfile?.pickup_address, bakerProfile?.pickup_city, bakerProfile?.pickup_province]
    .filter(Boolean)
    .join(", ");

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">🥐 Your order is ready for pickup!</h2>
      <p style="color:#6B5F54;line-height:1.5;">
        ${escapeHtml(order.baker_display_name || "The baker")} has your order for
        ${escapeHtml(order.order_name || "your order")} ready and waiting.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <img src="${qrDataUri}" alt="Pickup QR code" width="200" height="200" />
        <p style="color:#A89B8C;font-size:12px;margin-top:8px;">
          Show this at pickup. If it doesn't display, give the baker this code: <strong>${shortCode}</strong>
        </p>
      </div>
      ${addressLine ? `<p style="line-height:1.5;">📍 ${escapeHtml(addressLine)}</p>` : ""}
    </div>
  `;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Bakerï <hello@bakeriapp.com>",
      to: order.customer_email,
      subject: `Ready for pickup — ${order.order_name || "your order"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    console.error("Resend send failed:", await resendRes.text());
  }

  return json({ ok: true });
});
