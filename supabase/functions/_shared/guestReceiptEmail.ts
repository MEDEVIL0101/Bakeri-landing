// Shared by finalize-invoice-payment and finalize-guest-quote-payment — the
// two endpoints that mark a GUEST payment complete (buyer_profile_id always
// null there by construction). Neither ever sent the customer anything: the
// only record was the on-screen receipt at /pay/ or baker/pay-quote.html,
// gone the moment the tab closed. Best-effort only — a receipt email must
// never fail the payment finalize it's attached to, so every failure here is
// swallowed (and logged to notification_log) rather than thrown.
//
// Layout deliberately modeled on a standard App Store/Apple receipt (Harvey
// asked for this shape specifically, 2026-08-07): a "Receipt" header with
// date/order-id/seller meta, an item row with a product image, then a
// "Billing and Payment" section with the deposit/balance/total breakdown and
// a payment-method + total footer bar.
//
// Price rule (unchanged, and the one thing that must never regress): once a
// baker quotes a flat total (quoted_price), that quote is what's shown and
// charged — never the listing's raw per-item price. Item rows hide the
// misleading per-unit price whenever a quote overrides it, and a deposit
// gets its own Deposit/Balance rows (each with its own paid date) instead of
// collapsing to one Total line.

import { logNotification } from "./notificationLog.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ReceiptParams {
  orderId: string;
  leg: "deposit" | "balance" | "full";
  amountCents: number;
  paidAtIso: string;
}

interface ItemRow {
  custom_name: string;
  quantity: number;
  price_per_unit: number;
  menu_item_id: string | null;
}

// order_items.menu_item_id exists but isn't populated anywhere today (2026-08-07
// audit: 0 of 430 rows) — so this falls back to an exact, case-insensitive name
// match against the baker's own listings when there's no direct id. Scoped to
// bakerId, and only trusted when it resolves to exactly one listing, so a
// generic item name can't accidentally pull in the wrong photo.
// deno-lint-ignore no-explicit-any
async function resolveItemImageUrl(db: any, bakerId: string, item: ItemRow): Promise<string | null> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public`;

  let menuItemId = item.menu_item_id;
  if (!menuItemId) {
    const { data } = await db
      .from("menu_items")
      .select("id, has_image")
      .eq("user_id", bakerId)
      .ilike("name", item.custom_name)
      .is("deleted_at", null)
      .limit(2);
    if (data?.length === 1 && data[0].has_image) menuItemId = data[0].id;
    else return null;
  } else {
    const { data } = await db.from("menu_items").select("has_image").eq("id", menuItemId).maybeSingle();
    if (!data?.has_image) return null;
  }
  return `${STORAGE_URL}/menu-item-images/${bakerId.toUpperCase()}/${String(menuItemId).toUpperCase()}.jpg`;
}

// deno-lint-ignore no-explicit-any
export async function sendGuestPaymentReceiptEmail(db: any, params: ReceiptParams): Promise<void> {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, order_name, customer_name, customer_email, user_id, quoted_price, deposit_amount_cents, deposit_paid_at, invoice_code")
      .eq("id", params.orderId)
      .single();
    if (orderErr || !order) return;
    const customerEmail = (order.customer_email ?? "").trim();
    if (!customerEmail) return;

    const { data: items } = await db
      .from("order_items")
      .select("custom_name, quantity, price_per_unit, menu_item_id")
      .eq("order_id", order.id)
      .is("deleted_at", null);
    const itemRows: ItemRow[] = items ?? [];

    const { data: baker } = await db
      .from("profiles")
      .select("business_name, user_name, profile_slug")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";
    const bakerUrl = baker?.profile_slug
      ? `https://bakeriapp.com/${encodeURIComponent(baker.profile_slug)}`
      : "https://bakeriapp.com";

    const itemsTotalCents = Math.round(
      itemRows.reduce((s, i) => s + i.quantity * i.price_per_unit, 0) * 100
    );
    const quotedPrice = Number(order.quoted_price ?? 0);
    const hasQuote = quotedPrice > 0;
    const fullTotalCents = hasQuote ? Math.round(quotedPrice * 100) : itemsTotalCents;
    const depositCents = order.deposit_amount_cents ?? 0;
    const hasSplit = depositCents > 0 && depositCents < fullTotalCents;

    const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const dateStr = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const paidDateStr = dateStr(params.paidAtIso);
    const orderIdLabel = order.invoice_code || order.id.slice(0, 8).toUpperCase();

    // A single-item quote's item price IS the quote — safe to show. A
    // multi-item quote can't be split back into per-item prices, so those
    // rows show no price at all and the real total lives in the Payment
    // section below, same as before this redesign.
    const itemImages = await Promise.all(itemRows.map((i) => resolveItemImageUrl(db, order.user_id, i)));
    const itemsHtml = itemRows
      .map((i, idx) => {
        const lineCents = hasQuote
          ? (itemRows.length === 1 ? fullTotalCents : null)
          : (i.price_per_unit ? Math.round(i.price_per_unit * i.quantity * 100) : null);
        const imageUrl = itemImages[idx];
        const imageHtml = imageUrl
          ? `<img src="${imageUrl}" width="56" height="56" style="width:56px;height:56px;border-radius:10px;object-fit:cover;display:block;" alt="" />`
          : `<div style="width:56px;height:56px;border-radius:10px;background:#F0E9DC;"></div>`;
        return `<tr>
          <td style="width:56px;padding:10px 0;vertical-align:top;">${imageHtml}</td>
          <td style="padding:10px 0 10px 12px;vertical-align:top;">
            <div style="font-size:14.5px;font-weight:600;color:#241712;">${escapeHtml(i.custom_name)}</div>
            <div style="font-size:12.5px;color:#A89B8C;margin-top:2px;">${i.quantity}×</div>
            ${lineCents != null ? `<div style="font-size:13.5px;font-weight:700;color:#241712;margin-top:6px;">${fmt(lineCents)}</div>` : ""}
          </td>
        </tr>`;
      })
      .join("");

    let paymentRowsHtml: string;
    if (hasSplit) {
      const depositDateStr = params.leg === "deposit"
        ? paidDateStr
        : order.deposit_paid_at ? dateStr(order.deposit_paid_at) : "—";
      const balanceDateStr = params.leg === "balance" || params.leg === "full" ? paidDateStr : "Not yet paid";
      paymentRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Deposit</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${fmt(depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Paid ${escapeHtml(depositDateStr)}</span></td></tr>
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Balance</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${fmt(fullTotalCents - depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Paid ${escapeHtml(balanceDateStr)}</span></td></tr>
        <tr><td style="padding:10px 0 0;border-top:1px solid #E4D9C8;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:10px 0 0;border-top:1px solid #E4D9C8;text-align:right;font-size:13.5px;color:#241712;">${fmt(fullTotalCents)}</td></tr>
      `;
    } else {
      paymentRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${fmt(params.amountCents)}</td></tr>
      `;
    }

    const heading = params.leg === "deposit" ? "Deposit received"
      : params.leg === "balance" ? "Balance received"
      : "Payment received";

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;background:#fff;">
        <div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#A89B8C;text-transform:uppercase;">Bakerï</div>
        <h1 style="margin:14px 0 18px;font-size:26px;">Receipt</h1>

        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6B5F54;">
          <tr><td style="padding:2px 0;">${escapeHtml(dateStr(params.paidAtIso))}</td></tr>
          <tr><td style="padding:2px 0;"><strong style="color:#241712;">Order ID:</strong> ${escapeHtml(orderIdLabel)}</td></tr>
          <tr><td style="padding:2px 0;"><strong style="color:#241712;">Baker:</strong> <a href="${bakerUrl}" style="color:#6B5F54;">${escapeHtml(bakerName)}</a></td></tr>
          <tr><td style="padding:2px 0;"><strong style="color:#241712;">Email:</strong> ${escapeHtml(customerEmail)}</td></tr>
        </table>

        <div style="height:1px;background:#E4D9C8;margin:20px 0;"></div>

        <div style="font-size:20px;font-weight:700;margin-bottom:6px;">${heading}</div>
        <table style="width:100%;border-collapse:collapse;">
          ${itemsHtml}
        </table>

        <div style="height:1px;background:#E4D9C8;margin:20px 0;"></div>

        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Billing and Payment</div>
        <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#241712;margin-bottom:14px;">
          <tr><td style="padding:2px 0;">${escapeHtml((order.customer_name ?? "").trim() || "Guest")}</td></tr>
        </table>
        <table style="width:100%;border-collapse:collapse;">
          ${paymentRowsHtml}
        </table>

        <div style="height:1px;background:#E4D9C8;margin:14px 0 0;"></div>
        <table style="width:100%;border-collapse:collapse;margin-top:12px;">
          <tr>
            <td style="padding:6px 0;font-size:14px;font-weight:700;color:#241712;">Paid by credit card</td>
            <td style="padding:6px 0;text-align:right;font-size:16px;font-weight:700;color:#241712;">${fmt(params.amountCents)}</td>
          </tr>
        </table>

        <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:24px;">
          This payment is provided directly to ${escapeHtml(bakerName)}, who is solely
          responsible for preparing and fulfilling your order.
        </p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Bakerï <hello@bakeriapp.com>",
        to: customerEmail,
        subject: `${heading} — ${bakerName} — ${fmt(params.amountCents)}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Resend send failed for ${customerEmail}: ${res.status} ${errText}`);
      await logNotification(db, order.id, "guest_payment_receipt", "failed", errText.slice(0, 500));
      return;
    }
    await logNotification(db, order.id, "guest_payment_receipt", "sent");
  } catch (err: unknown) {
    console.error("sendGuestPaymentReceiptEmail failed:", err instanceof Error ? err.message : err);
  }
}
