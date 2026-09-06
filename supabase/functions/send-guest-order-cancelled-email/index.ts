import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";

// Trigger-invoked (x-webhook-secret, not a JWT) by call_guest_order_webhook()
// in the →cancelled branch of trg_fn_marketplace_order_notify — covers every
// path that ends in marketplace_status = 'cancelled' (baker cancel via
// cancel-order, buyer cancel, or cron expiry), since it's the trigger firing
// on the status change, not any one caller. Notification only — cancel-order
// already issues the actual Stripe refund synchronously before this fires,
// so there's no refund logic to duplicate here (see cancel-order/index.ts).

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
    .select("id, order_name, customer_email, baker_display_name, user_id")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    await logNotification(db, orderId, "guest_order_cancelled", "failed", orderErr?.message ?? "order not found or missing customer_email");
    return json({ error: "Order not found." }, 400);
  }

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Order cancelled</h2>
      <p style="color:#6B5F54;line-height:1.5;">
        Your order for ${escapeHtml(order.order_name || "your order")} with
        ${escapeHtml(order.baker_display_name || "the baker")} has been cancelled.
        If you were charged, a full refund has been issued to your payment method — please
        allow a few business days for it to appear.
      </p>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin-top:16px;">
        Questions about this cancellation? Just reply to this email — it reaches
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
      subject: `Order cancelled — ${order.order_name || "your order"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend send failed:", errText);
    await logNotification(db, orderId, "guest_order_cancelled", "failed", errText.slice(0, 500));
  } else {
    await logNotification(db, orderId, "guest_order_cancelled", "sent");
  }

  return json({ ok: true });
});
