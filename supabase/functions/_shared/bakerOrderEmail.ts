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
  /** The order, so a quote request links straight to it in the web app. */
  orderId?: string;
}

/**
 * Quote request (Harvey 2026-11-03): short and pointed at the next step —
 * who's asking, what for, how to reach them, and a button to respond in
 * Bakerï. (It used to reuse the receipt layout, which read like a sale and
 * suggested replying to the email with a price.)
 */
export function quoteRequestHtml(p: BakerOrderEmailParams): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 0;width:120px;font-size:14px;color:#8a7f88;vertical-align:top;">${label}</td><td style="padding:4px 0;font-size:14px;color:#14110e;vertical-align:top;">${value}</td></tr>`;
  const items = p.items.map((i) =>
    `<tr><td style="padding:4px 0;font-size:14px;font-weight:700;color:#14110e;">${escapeHtml(i.custom_name)}</td><td style="padding:4px 0;font-size:14px;color:#3d353f;text-align:right;white-space:nowrap;">Qty ${escapeHtml(String(i.quantity ?? 1))}</td></tr>`).join("");
  const customer = [
    row("Name", escapeHtml(p.customerName || "—")),
    p.customerPhone ? row("Phone", `<a href="tel:${escapeHtml(p.customerPhone.replace(/[^\d+]/g, ""))}" style="color:#14110e;">${escapeHtml(p.customerPhone)}</a>`) : "",
    p.customerEmail ? row("Email", `<a href="mailto:${escapeHtml(p.customerEmail)}" style="color:#14110e;">${escapeHtml(p.customerEmail)}</a>`) : "",
  ].join("");
  const link = p.orderId ? `https://bakeriapp.com/app/orders/${p.orderId}` : "https://bakeriapp.com/app/orders";
  const font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f3ecdd;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3ecdd;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
  <tr><td align="center" style="padding:4px 0 20px;"><img src="https://bakeriapp.com/assets/site-v3/bakeri-wordmark.png" width="128" alt="Bakerï" style="display:block;width:128px;height:auto;border:0;" /></td></tr>
  <tr><td style="background-color:#ffffff;border-radius:18px;padding:32px 32px 28px;${font}">
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#14110e;">You received a quote request</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3d353f;">from <b style="color:#14110e;">${escapeHtml(p.customerName || "a customer")}</b></p>

    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a7f88;margin:0 0 6px;">Item details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid #ece3d5;padding-top:6px;">${items}</table>

    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a7f88;margin:0 0 6px;">Customer details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;border-top:1px solid #ece3d5;padding-top:6px;">${customer}</table>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3d353f;">Log in to your Bakerï account to see their answers and send a quote.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#14110e;border-radius:999px;">
      <a href="${link}" style="display:inline-block;padding:13px 28px;${font}font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Respond to request</a>
    </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:18px 12px 4px;${font}font-size:12px;line-height:1.6;color:#8a7f88;">
    You're getting this because someone sent a request from your Bakerï storefront.
  </td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendBakerOrderEmail(p: BakerOrderEmailParams): Promise<{ ok: boolean; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!p.bakerEmail) return { ok: false, error: "baker has no email on file" };

  const isSale = p.kind === "sale";
  const itemLabel = p.items.length === 1 ? p.items[0].custom_name : `${p.items.length} items`;

  if (!isSale) {
    return await deliver(resendApiKey, p, `Quote request from ${p.customerName || "a customer"} — ${itemLabel}`, quoteRequestHtml(p));
  }

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

  return await deliver(resendApiKey, p, `You just made a sale — ${itemLabel}`, html);
}

async function deliver(resendApiKey: string, p: BakerOrderEmailParams, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
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
        subject,
        html,
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
