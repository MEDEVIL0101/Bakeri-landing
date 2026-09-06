// Baker-facing order/quote-request emails — the counterpart to the various
// guest-facing "your order/receipt" emails (send-guest-*, guestReceiptEmail.ts),
// which never once email the baker themselves (confirmed by audit 2026-08-21:
// every existing Resend send in this repo targets the buyer/guest, or the
// prospective-vendor applicant). This is the first baker-facing email path —
// built on the same renderReceiptShell used by send-guest-quote-email/
// send-invoice-email/guestReceiptEmail.ts, so it reads as the same product
// rather than a fourth template that drifted in its own direction. The "from
// X" slot (normally the baker's own name, since a guest is buying *from* the
// baker) is repurposed to show the customer's name instead — from the
// baker's side, the customer is the other party in this transaction.
//
// Two flavors, one shell:
//  - "sale": a digital/physical/baked-goods purchase just completed (or, for
//    baked goods, landed as a new pending order awaiting the baker's accept —
//    same "you have something to act on" moment). Shows the item(s) sold and
//    a total.
//  - "quote_request": a custom-order inquiry just came in. No firm price yet
//    (the baker hasn't quoted), so items render with no price line and the
//    breakdown section prompts the baker to reply with a quote instead of
//    showing a total.
//
// Rate limiting for quote_request specifically isn't reimplemented here — it
// rides on submit-custom-order-inquiry's existing trg_web_inquiry_limits
// Postgres trigger (5 inquiries per IP per rolling 24h, enforced on the
// orders INSERT itself). If that insert is rejected, submit-custom-order-
// inquiry already returns 429 before this module is ever called, so a spam
// burst can produce at most 5 of these emails per IP per day — not 100.

import {
  escapeHtml,
  formatCents,
  formatDate,
  metaRow,
  renderReceiptItemsHtml,
  renderReceiptShell,
  ReceiptItemInput,
} from "./receiptEmailStyle.ts";

export interface BakerOrderEmailParams {
  // deno-lint-ignore no-explicit-any
  db: any;
  bakerId: string;
  bakerEmail: string;
  items: ReceiptItemInput[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  // Physical (ships) sales only — the buyer's shipping address, one line per row.
  addressLines?: string[];
  // Omitted for quote_request — there's no firm total until the baker quotes it.
  totalCents?: number;
  kind: "sale" | "quote_request";
}

export async function sendBakerOrderEmail(p: BakerOrderEmailParams): Promise<{ ok: boolean; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!p.bakerEmail) return { ok: false, error: "baker has no email on file" };

  const isSale = p.kind === "sale";
  const itemLabel = p.items.length === 1 ? p.items[0].custom_name : `${p.items.length} items`;

  const itemsHtml = await renderReceiptItemsHtml(p.db, p.bakerId, p.items, false, 0);

  const buyerDetailRows: string[] = [metaRow("Email", escapeHtml(p.customerEmail))];
  if (p.customerPhone) buyerDetailRows.push(metaRow("Phone", escapeHtml(p.customerPhone)));
  if (p.addressLines && p.addressLines.length > 0) {
    buyerDetailRows.push(metaRow("Ships to", p.addressLines.map((l) => escapeHtml(l)).join("<br/>")));
  }

  const breakdownRowsHtml = isSale && p.totalCents != null
    ? `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Total</td>
        <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;font-weight:700;">${formatCents(p.totalCents)}</td></tr>`
    : `<tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;" colspan="2">No price yet — reply with a quote from your Orders list.</td></tr>`;

  const footerHtml = `
    <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin-top:10px;">
      ${isSale ? "This is an automatic notification of a completed sale." : "This is an automatic notification of a new quote request."}
      Manage it from your Orders list in the Bakerï app.
    </p>
  `;

  const html = renderReceiptShell({
    docType: isSale ? "Sale" : "Quote Request",
    bakerName: p.customerName,
    bakerUrl: `mailto:${p.customerEmail}`,
    metaRowsHtml: [
      metaRow("", escapeHtml(formatDate(new Date().toISOString()))),
      metaRow("Email", escapeHtml(p.customerEmail)),
    ].join(""),
    heading: isSale ? "You just made a sale! 🎉" : "New quote request",
    itemsHtml,
    sectionTitle: "Buyer Details",
    sectionSubRowHtml: buyerDetailRows.join(""),
    breakdownRowsHtml,
    footerHtml,
    legalHtml: "",
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: "Bakerï <hello@bakeriapp.com>",
        // So the baker can just hit Reply to reach the customer directly —
        // Bakerï runs no in-app messaging and shouldn't be the middleman on
        // a storefront order. Omitted when there's no usable customer email.
        reply_to: p.customerEmail?.includes("@") ? p.customerEmail : undefined,
        to: p.bakerEmail,
        subject: isSale ? `You just made a sale — ${itemLabel}` : `New quote request — ${itemLabel}`,
        html,
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
