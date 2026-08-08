import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";
import {
  escapeHtml,
  formatDate,
  metaRow,
  renderReceiptItemsHtml,
  renderReceiptShell,
} from "../_shared/receiptEmailStyle.ts";

// Called directly by mark-order-ready-for-pickup (2026-08-07) — not by the
// DB trigger anymore. That function owns the whole ready-for-pickup
// notification itself, since it needs the specific pickup date/time window
// the trigger has no way to know, and needs to fire again on a plain
// reschedule (same status, different time), which the trigger's
// only-on-a-status-change guard can never do. Built on
// receiptEmailStyle.ts's shared shell — same wordmark/baker-prominence/
// item-photo shape as the quote/invoice/receipt emails, with "Pickup
// Details" in place of "Billing and Payment" since this one isn't about
// money at all.

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
  const isReschedule = body.is_reschedule === true;
  if (!orderId) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, order_name, customer_name, customer_email, user_id, quoted_price, scheduled_pickup_date, pickup_window_start, pickup_window_end, invoice_code")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    await logNotification(db, orderId, "guest_order_ready", "failed", orderErr?.message ?? "order not found or missing customer_email");
    return json({ error: "Order not found." }, 400);
  }
  if (!order.scheduled_pickup_date || !order.pickup_window_start || !order.pickup_window_end) {
    return json({ error: "Missing pickup window." }, 400);
  }

  const { data: items } = await db
    .from("order_items")
    .select("custom_name, quantity, price_per_unit, menu_item_id")
    .eq("order_id", order.id)
    .is("deleted_at", null);
  const itemRows = items ?? [];

  const { data: baker } = await db
    .from("profiles")
    .select("business_name, user_name, profile_slug, email, pickup_address, pickup_city, pickup_province")
    .eq("id", order.user_id)
    .single();
  const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";
  const bakerUrl = baker?.profile_slug
    ? `https://bakeriapp.com/${encodeURIComponent(baker.profile_slug)}`
    : "https://bakeriapp.com";
  const addressLine = [baker?.pickup_address, baker?.pickup_city, baker?.pickup_province].filter(Boolean).join(", ");

  const quotedPrice = Number(order.quoted_price ?? 0);
  const hasQuote = quotedPrice > 0;
  const itemsHtml = await renderReceiptItemsHtml(db, order.user_id, itemRows, hasQuote, Math.round(quotedPrice * 100));

  // scheduled_pickup_date is a timestamptz storing just a calendar day (the
  // baker picks a date, not a moment in time) — formatting it in whatever
  // timezone this function happens to run in would risk it landing on the
  // *previous* day for anyone west of UTC (e.g. a stored midnight-UTC value
  // reads back as 8pm the day before in US/Canada). Reading it back as UTC
  // is what makes it round-trip to the same calendar day it was set to.
  const pickupDateFull = new Date(order.scheduled_pickup_date).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
  const windowStr = `${escapeHtml(order.pickup_window_start)} – ${escapeHtml(order.pickup_window_end)}`;

  // The whole point of this email — shown big, not buried in a table row.
  const prominentDateTimeHtml = `
    <div style="margin:18px 0;padding:18px 16px;background:#F7F2E9;border-radius:10px;text-align:center;">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.02em;color:#A89B8C;text-transform:uppercase;">${isReschedule ? "New pickup time" : "Pickup window"}</div>
      <div style="font-size:22px;font-weight:700;color:#241712;margin-top:6px;">${escapeHtml(pickupDateFull)}</div>
      <div style="font-size:17px;color:#4A3E33;margin-top:2px;">${windowStr}</div>
    </div>
  `;

  const detailRows = [
    addressLine ? `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Address</td><td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${escapeHtml(addressLine)}</td></tr>` : "",
    `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Contact</td><td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${escapeHtml(bakerName)}${baker?.email ? `<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">${escapeHtml(baker.email)}</span>` : ""}</td></tr>`,
  ].filter(Boolean).join("");

  const heading = isReschedule ? "Your pickup time has changed" : "Your order is ready for pickup!";
  const legalHtml = `
    <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;">
      Can't make this time, or something's come up? Reach out to ${escapeHtml(bakerName)} directly using the contact info above.
    </p>
  `;

  const html = renderReceiptShell({
    docType: isReschedule ? "Pickup Rescheduled" : "Pickup Ready",
    bakerName,
    bakerUrl,
    metaRowsHtml: [
      metaRow("", escapeHtml(formatDate(new Date().toISOString()))),
      metaRow("Order ID", escapeHtml(order.invoice_code || order.id.slice(0, 8).toUpperCase())),
      metaRow("Email", escapeHtml(order.customer_email)),
    ].join(""),
    heading,
    itemsHtml,
    afterItemsHtml: prominentDateTimeHtml,
    sectionTitle: "Pickup Details",
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
      from: "Bakerï <hello@bakeriapp.com>",
      to: order.customer_email,
      subject: (isReschedule ? "Pickup time updated — " : "Ready for pickup — ") + (order.order_name || "your order"),
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend send failed:", errText);
    await logNotification(db, orderId, "guest_order_ready", "failed", errText.slice(0, 500));
  } else {
    await logNotification(db, orderId, "guest_order_ready", "sent");
  }

  return json({ ok: true });
});
