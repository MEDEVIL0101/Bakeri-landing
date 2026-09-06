import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";
import {
  escapeHtml,
  formatDate,
  metaRow,
  renderReceiptItemsHtml,
  renderReceiptShell,
} from "../_shared/receiptEmailStyle.ts";

// Called directly by cancel-order's refund branch (a physical order that
// had already progressed past awaiting_shipment/preparing/shipped/delivered
// before the baker issued a refund — see
// 20260823000001_physical_order_lifecycle.sql). Same shell as
// send-guest-order-shipped-email/send-guest-order-delivered-email; the
// pre-fulfillment true-cancel path has its own notification via the DB
// trigger and does not use this.

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

  try {
    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, order_name, customer_name, customer_email, user_id, refunded_at, invoice_code")
      .eq("id", orderId)
      .single();

    if (orderErr || !order || !order.customer_email) {
      throw new Error(orderErr?.message ?? "order not found or missing customer_email");
    }

    const { data: items } = await db
      .from("order_items")
      .select("custom_name, quantity, price_per_unit, menu_item_id")
      .eq("order_id", order.id)
      .is("deleted_at", null);
    const itemRows = items ?? [];

    const { data: baker } = await db
      .from("profiles")
      .select("business_name, user_name, profile_slug, email")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";
    const bakerUrl = baker?.profile_slug
      ? `https://bakeriapp.com/${encodeURIComponent(baker.profile_slug)}`
      : "https://bakeriapp.com";

    const identity = await customerEmailIdentity(db, order.user_id, bakerName, baker?.email);

    const itemsHtml = await renderReceiptItemsHtml(db, order.user_id, itemRows, false, 0);

    const refundedHtml = `
      <div style="margin:18px 0;padding:18px 16px;background:#F7F2E9;border-radius:10px;text-align:center;">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.02em;color:#A89B8C;text-transform:uppercase;">Refunded</div>
        <div style="font-size:22px;font-weight:700;color:#241712;margin-top:6px;">A full refund has been issued</div>
      </div>
    `;

    const detailRows = [
      `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Contact</td><td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${escapeHtml(bakerName)}${identity.reply_to ? `<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">${escapeHtml(identity.reply_to)}</span>` : ""}</td></tr>`,
    ].join("");

    const legalHtml = `
      <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;">
        The refund should appear on your original payment method within 5–10 business days. Questions? Reply to this email or use the contact info above — either way it reaches ${escapeHtml(bakerName)} directly.
      </p>
    `;

    const html = renderReceiptShell({
      docType: "Refund",
      bakerName,
      bakerUrl,
      metaRowsHtml: [
        metaRow("", escapeHtml(formatDate(order.refunded_at ?? new Date().toISOString()))),
        metaRow("Order ID", escapeHtml(order.invoice_code || order.id.slice(0, 8).toUpperCase())),
        metaRow("Email", escapeHtml(order.customer_email)),
      ].join(""),
      heading: "Your order has been refunded",
      itemsHtml,
      afterItemsHtml: refundedHtml,
      sectionTitle: "Order Details",
      sectionSubRowHtml: metaRow("", escapeHtml((order.customer_name ?? "").trim() || "Guest")),
      breakdownRowsHtml: detailRows,
      footerHtml: "",
      legalHtml,
    });

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
        subject: "Your order has been refunded — " + (order.order_name || "your order"),
        html,
      }),
    });

    if (!resendRes.ok) {
      throw new Error(`resend_failed: ${(await resendRes.text()).slice(0, 500)}`);
    }

    await logNotification(db, orderId, "guest_order_refunded", "sent");
    return json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`send-guest-order-refunded-email failed for order ${orderId}:`, message);
    await logNotification(db, orderId, "guest_order_refunded", "failed", message.slice(0, 500));
    return json({ error: message }, 400);
  }
});
