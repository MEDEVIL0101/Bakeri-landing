// Shared by finalize-invoice-payment and finalize-guest-quote-payment — the
// two endpoints that mark a GUEST payment complete (buyer_profile_id always
// null there by construction). Neither ever sent the customer anything: the
// only record was the on-screen receipt at /pay/ or baker/pay-quote.html,
// gone the moment the tab closed. Best-effort only — a receipt email must
// never fail the payment finalize it's attached to, so every failure here is
// swallowed (and logged to notification_log) rather than thrown.
//
// Mirrors pay/index.html's renderReceipt exactly: item rows hide the
// misleading per-unit price once a flat quote overrides it, and a deposit
// gets its own Deposit/Balance breakdown (each with its paid date) instead
// of collapsing to one Total line.

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

// deno-lint-ignore no-explicit-any
export async function sendGuestPaymentReceiptEmail(db: any, params: ReceiptParams): Promise<void> {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, order_name, customer_name, customer_email, user_id, quoted_price, deposit_amount_cents, deposit_paid_at")
      .eq("id", params.orderId)
      .single();
    if (orderErr || !order) return;
    const customerEmail = (order.customer_email ?? "").trim();
    if (!customerEmail) return;

    const { data: items } = await db
      .from("order_items")
      .select("custom_name, quantity, price_per_unit")
      .eq("order_id", order.id)
      .is("deleted_at", null);

    const { data: baker } = await db
      .from("profiles")
      .select("business_name, user_name")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";

    const itemsTotalCents = Math.round(
      (items ?? []).reduce((s: number, i: { quantity: number; price_per_unit: number }) => s + i.quantity * i.price_per_unit, 0) * 100
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

    const itemsHtml = (items ?? [])
      .map((i: { custom_name: string; quantity: number; price_per_unit: number }) => {
        // Once a flat quote overrides the listing's raw per-unit price,
        // showing that stale price next to the item reads as a mismatch
        // against the real total below it — see 2026-08-07 SUPPORT_LOG entry.
        const lineTotal = !hasQuote && i.price_per_unit ? (i.price_per_unit * i.quantity).toFixed(2) : null;
        return `<tr>
          <td style="padding:6px 0;font-size:13.5px;color:#241712;">${i.quantity}× ${escapeHtml(i.custom_name)}</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${lineTotal ? "$" + lineTotal : ""}</td>
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
        <tr><td style="padding:6px 0;font-size:13.5px;">Deposit</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;">${fmt(depositCents)}<br><span style="font-size:11px;color:#A89B8C;">${escapeHtml(depositDateStr)}</span></td></tr>
        <tr><td style="padding:6px 0;font-size:13.5px;">Balance</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;">${fmt(fullTotalCents - depositCents)}<br><span style="font-size:11px;color:#A89B8C;">${escapeHtml(balanceDateStr)}</span></td></tr>
        <tr><td style="padding:10px 0 0;font-weight:700;font-size:13.5px;">Total</td>
          <td style="padding:10px 0 0;text-align:right;font-weight:700;font-size:13.5px;">${fmt(fullTotalCents)}</td></tr>
      `;
    } else {
      paymentRowsHtml = `
        <tr><td style="padding:6px 0;font-weight:700;font-size:13.5px;">Total</td>
          <td style="padding:6px 0;text-align:right;font-weight:700;font-size:13.5px;">${fmt(params.amountCents)}</td></tr>
      `;
    }

    const heading = params.leg === "deposit" ? "Deposit received"
      : params.leg === "balance" ? "Balance received"
      : "Payment received";
    const firstName = (order.customer_name ?? "").trim().split(/\s+/)[0] || "";
    const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
        <h2 style="margin:0 0 8px;">${heading}</h2>
        <p style="line-height:1.5;">${greeting}</p>
        <p style="line-height:1.5;color:#6B5F54;">
          Your payment to ${escapeHtml(bakerName)} for
          <strong>${escapeHtml(order.order_name || "your order")}</strong> is confirmed.
        </p>
        ${itemsHtml ? `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:14px;">${itemsHtml}</table>` : ""}
        <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:${itemsHtml ? "6" : "16"}px;border-top:1px solid #E4D9C8;padding-top:6px;">
          ${paymentRowsHtml}
        </table>
        <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;border-top:1px solid #E4D9C8;padding-top:16px;">
          Paid ${paidDateStr} via credit card. This payment is provided directly to ${escapeHtml(bakerName)},
          who is solely responsible for preparing and fulfilling your order.
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
