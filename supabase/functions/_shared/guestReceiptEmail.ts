// Shared by finalize-invoice-payment and finalize-guest-quote-payment — the
// two endpoints that mark a GUEST payment complete (buyer_profile_id always
// null there by construction). Neither ever sent the customer anything: the
// only record was the on-screen receipt at /pay/ or baker/pay-quote.html,
// gone the moment the tab closed. Best-effort only — a receipt email must
// never fail the payment finalize it's attached to, so every failure here is
// swallowed (and logged to notification_log) rather than thrown.
//
// Built on receiptEmailStyle.ts's shared shell — same wordmark/doc-type/meta
// block/item-row/"Billing and Payment" shape as send-guest-quote-email and
// send-invoice-email, so the whole quote → invoice → receipt sequence reads
// as one product (2026-08-07).

import { logNotification } from "./notificationLog.ts";
import {
  escapeHtml,
  formatCents,
  formatDate,
  metaRow,
  renderReceiptItemsHtml,
  renderReceiptShell,
  type ReceiptItemInput,
} from "./receiptEmailStyle.ts";

interface ReceiptParams {
  orderId: string;
  leg: "deposit" | "balance" | "full";
  amountCents: number;
  paidAtIso: string;
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
    const itemRows: ReceiptItemInput[] = items ?? [];

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

    const paidDateStr = formatDate(params.paidAtIso);
    const orderIdLabel = order.invoice_code || order.id.slice(0, 8).toUpperCase();

    const itemsHtml = await renderReceiptItemsHtml(db, order.user_id, itemRows, hasQuote, fullTotalCents);

    let breakdownRowsHtml: string;
    if (hasSplit) {
      const depositDateStr = params.leg === "deposit"
        ? paidDateStr
        : order.deposit_paid_at ? formatDate(order.deposit_paid_at) : "—";
      const balanceDateStr = params.leg === "balance" || params.leg === "full" ? paidDateStr : "Not yet paid";
      breakdownRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Deposit</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Paid ${escapeHtml(depositDateStr)}</span></td></tr>
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Balance</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(fullTotalCents - depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Paid ${escapeHtml(balanceDateStr)}</span></td></tr>
        <tr><td style="padding:10px 0 0;border-top:1px solid #E4D9C8;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:10px 0 0;border-top:1px solid #E4D9C8;text-align:right;font-size:13.5px;color:#241712;">${formatCents(fullTotalCents)}</td></tr>
      `;
    } else {
      breakdownRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(params.amountCents)}</td></tr>
      `;
    }

    const heading = params.leg === "deposit" ? "Deposit received"
      : params.leg === "balance" ? "Balance received"
      : "Payment received";

    const footerHtml = `
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <tr>
          <td style="padding:6px 0;font-size:14px;font-weight:700;color:#241712;">Paid by credit card</td>
          <td style="padding:6px 0;text-align:right;font-size:16px;font-weight:700;color:#241712;">${formatCents(params.amountCents)}</td>
        </tr>
      </table>
    `;
    const legalHtml = `
      <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:24px;">
        This payment is provided directly to ${escapeHtml(bakerName)}, who is solely
        responsible for preparing and fulfilling your order.
      </p>
    `;

    const html = renderReceiptShell({
      docType: "Receipt",
      metaRowsHtml: [
        metaRow("", escapeHtml(paidDateStr)),
        metaRow("Order ID", escapeHtml(orderIdLabel)),
        metaRow("Baker", `<a href="${bakerUrl}" style="color:#6B5F54;">${escapeHtml(bakerName)}</a>`),
        metaRow("Email", escapeHtml(customerEmail)),
      ].join(""),
      heading,
      itemsHtml,
      sectionSubRowHtml: metaRow("", escapeHtml((order.customer_name ?? "").trim() || "Guest")),
      breakdownRowsHtml,
      footerHtml,
      legalHtml,
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Bakerï <hello@bakeriapp.com>",
        to: customerEmail,
        subject: `${heading} — ${bakerName} — ${formatCents(params.amountCents)}`,
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
