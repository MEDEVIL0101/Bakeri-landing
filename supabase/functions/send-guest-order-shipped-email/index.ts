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

// Called directly by mark-order-shipped, same shape as
// send-guest-order-ready-email (which it's modeled on) being called by
// mark-order-ready-for-pickup — built on receiptEmailStyle.ts's shared
// shell so this reads as the same email family as the quote/invoice/receipt/
// ready-for-pickup emails, with a "Shipping Details" section (tracking +
// ship-to address) in place of "Billing and Payment".
//
// Also sent (with is_correction: true in the request body) when the baker
// corrects an already-recorded tracking number/carrier — same template,
// just a different heading/subject so it doesn't read as a duplicate
// "shipped" notification.

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

interface ShippingAddress {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
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
  const isCorrection = body.is_correction === true;
  const eventType = isCorrection ? "guest_order_tracking_updated" : "guest_order_shipped";

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Whole body wrapped in try/catch, same reasoning as
  // send-guest-order-ready-email — an unhandled failure here left literally
  // no trace anywhere on that function's original bug, since the caller's
  // fetch() doesn't throw on a non-2xx response either.
  try {
    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, order_name, customer_name, customer_email, user_id, shipping_address, tracking_number, shipping_carrier, shipped_at, invoice_code")
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

    const addr = (order.shipping_address ?? {}) as ShippingAddress;
    const addressLines = [
      addr.name,
      addr.line1,
      addr.line2,
      [addr.city, addr.province, addr.postal_code].filter(Boolean).join(", "),
      addr.country,
    ].filter(Boolean) as string[];
    const addressHtml = addressLines.map((l) => escapeHtml(l)).join("<br/>");

    const carrier = (order.shipping_carrier ?? "").trim();
    const trackingNumber = (order.tracking_number ?? "").trim();

    // The whole point of this email — shown big, not buried in a table row,
    // same treatment send-guest-order-ready-email gives the pickup window.
    const prominentTrackingHtml = `
      <div style="margin:18px 0;padding:18px 16px;background:#F7F2E9;border-radius:10px;text-align:center;">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.02em;color:#A89B8C;text-transform:uppercase;">${carrier ? "Shipped via" : "On its way"}</div>
        <div style="font-size:22px;font-weight:700;color:#241712;margin-top:6px;">${carrier ? escapeHtml(carrier) : "Your order has shipped"}</div>
        ${trackingNumber ? `<div style="font-size:17px;color:#4A3E33;margin-top:2px;">${escapeHtml(trackingNumber)}</div>` : ""}
      </div>
    `;

    const detailRows = [
      addressLines.length ? `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;vertical-align:top;">Ship to</td><td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${addressHtml}</td></tr>` : "",
      `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Contact</td><td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${escapeHtml(bakerName)}${identity.reply_to ? `<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">${escapeHtml(identity.reply_to)}</span>` : ""}</td></tr>`,
    ].filter(Boolean).join("");

    const legalHtml = `
      <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;">
        Questions about your shipment? Reply to this email or use the contact info above — either way it reaches ${escapeHtml(bakerName)} directly.
      </p>
    `;

    const html = renderReceiptShell({
      docType: "Shipped",
      bakerName,
      bakerUrl,
      metaRowsHtml: [
        metaRow("", escapeHtml(formatDate(order.shipped_at ?? new Date().toISOString()))),
        metaRow("Order ID", escapeHtml(order.invoice_code || order.id.slice(0, 8).toUpperCase())),
        metaRow("Email", escapeHtml(order.customer_email)),
      ].join(""),
      heading: isCorrection ? "Your tracking info was updated" : "Your order has shipped!",
      itemsHtml,
      afterItemsHtml: prominentTrackingHtml,
      sectionTitle: "Shipping Details",
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
        subject: (isCorrection ? "Updated tracking — " : "Your order has shipped — ") + (order.order_name || "your order"),
        html,
      }),
    });

    if (!resendRes.ok) {
      throw new Error(`resend_failed: ${(await resendRes.text()).slice(0, 500)}`);
    }

    await logNotification(db, orderId, eventType, "sent");
    return json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`send-guest-order-shipped-email failed for order ${orderId}:`, message);
    await logNotification(db, orderId, eventType, "failed", message.slice(0, 500));
    return json({ error: message }, 400);
  }
});
