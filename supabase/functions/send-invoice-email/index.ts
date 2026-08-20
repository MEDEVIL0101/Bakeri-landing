import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  escapeHtml,
  formatCents,
  formatDate,
  metaRow,
  renderReceiptItemsHtml,
  renderReceiptShell,
} from "../_shared/receiptEmailStyle.ts";

// Baker-triggered: "Email Invoice" button on OrderDetailView. Requires the
// caller's own session and confirms they own the order before sending —
// unlike the web guest-payment functions, this one always has a real baker
// JWT behind it.
//
// Built on receiptEmailStyle.ts's shared shell (2026-08-07) — same
// wordmark/doc-type/meta block/item-row/"Billing and Payment" shape as
// send-guest-quote-email and the payment receipt, so the whole quote →
// invoice → receipt sequence a guest receives reads as one product. Replaces
// the old standalone template.ts placeholder file.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { order_id }: { order_id: string } = await req.json();
    if (!order_id) throw new Error("Missing order_id");

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, customer_name, customer_email, invoice_code, due_date, invoice_type, deposit_amount_cents, deposit_paid_at, quoted_price")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("not_found");
    if (order.user_id !== user.id) throw new Error("forbidden");
    if (!order.invoice_code) throw new Error("generate_invoice_first");
    const customerEmail = (order.customer_email ?? "").trim();
    if (!customerEmail) throw new Error("no_email_on_file");

    const { data: items } = await supabase
      .from("order_items")
      .select("custom_name, quantity, price_per_unit, variant_breakdown, menu_item_id")
      .eq("order_id", order.id)
      .is("deleted_at", null);
    const itemRows = items ?? [];
    const itemsTotal = itemRows.reduce((sum: number, i: { quantity: number; price_per_unit: number }) => sum + i.quantity * i.price_per_unit, 0);

    // The amount stated in the email must match what this specific invoice
    // actually charges — a deposit or balance invoice covers only part of
    // the total. Same math (including the quoted_price-over-order_items
    // fallback for a custom/marketplace quote) as create-invoice-payment-intent —
    // otherwise this email can state a stale "from" price instead of what the
    // baker actually quoted.
    const invoiceType = order.invoice_type ?? "full";
    const depositAmount = (order.deposit_amount_cents ?? 0) / 100;
    const quotedPrice = Number(order.quoted_price ?? 0);
    const hasQuote = quotedPrice > 0;
    const effectiveTotal = hasQuote ? quotedPrice : itemsTotal;
    if (effectiveTotal <= 0) throw new Error("no_amount_due");
    const total = invoiceType === "deposit" ? depositAmount
      : invoiceType === "balance" ? Math.max(effectiveTotal - depositAmount, 0)
      : effectiveTotal;
    if (total <= 0) throw new Error("no_amount_due");

    const { data: baker } = await supabase
      .from("profiles")
      .select("business_name, user_name, profile_slug")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";
    const bakerUrl = baker?.profile_slug
      ? `https://bakeriapp.com/${encodeURIComponent(baker.profile_slug)}`
      : "https://bakeriapp.com";

    const payUrl = `https://bakeriapp.com/pay/?code=${encodeURIComponent(order.invoice_code)}`;
    const amountCents = Math.round(total * 100);
    const effectiveTotalCents = Math.round(effectiveTotal * 100);
    const heading = invoiceType === "deposit" ? "Your deposit is due"
      : invoiceType === "balance" ? "Your balance is due"
      : "Your invoice is ready";
    const payLabel = invoiceType === "deposit" ? "Pay Deposit "
      : invoiceType === "balance" ? "Pay Balance "
      : "Pay ";

    const itemsHtml = await renderReceiptItemsHtml(supabase, order.user_id, itemRows, hasQuote, effectiveTotalCents);

    // Same deposit/balance/order-total shape as the quote email and the
    // receipt — a balance invoice shows the deposit already paid (with its
    // date) alongside the balance now due, not just the one amount due today.
    const depositCents = order.deposit_amount_cents ?? 0;
    let breakdownRowsHtml: string;
    if (invoiceType === "balance" && depositCents > 0) {
      breakdownRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Deposit</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">${order.deposit_paid_at ? "Paid " + escapeHtml(formatDate(order.deposit_paid_at)) : "Paid"}</span></td></tr>
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Balance</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(amountCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Due now</span></td></tr>
        <tr><td style="padding:10px 0 0;border-top:1px solid #E4D9C8;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:10px 0 0;border-top:1px solid #E4D9C8;text-align:right;font-size:13.5px;color:#241712;">${formatCents(effectiveTotalCents)}</td></tr>
      `;
    } else if (invoiceType === "deposit") {
      breakdownRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Deposit</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(amountCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Due now</span></td></tr>
        <tr><td style="padding:10px 0 0;border-top:1px solid #E4D9C8;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:10px 0 0;border-top:1px solid #E4D9C8;text-align:right;font-size:13.5px;color:#241712;">${formatCents(effectiveTotalCents)}</td></tr>
      `;
    } else {
      breakdownRowsHtml = `
        <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Order total</td>
          <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(amountCents)}</td></tr>
      `;
    }

    const dueDateHtml = order.due_date
      ? `<p style="color:#A89B8C;font-size:12px;line-height:1.5;text-align:center;margin-top:-4px;">Due ${escapeHtml(formatDate(order.due_date))}</p>`
      : "";
    const footerHtml = `
      <div style="text-align:center;margin:22px 0 10px;">
        <a href="${payUrl}" style="display:inline-block;background:#241712;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;">
          ${payLabel}${formatCents(amountCents)}
        </a>
      </div>
      ${dueDateHtml}
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;text-align:center;">
        Or copy this link into your browser: ${payUrl}
      </p>
    `;
    const legalHtml = `
      <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;">
        This invoice is provided directly by ${escapeHtml(bakerName)}, who is solely
        responsible for preparing and fulfilling your order. If you have any
        questions about it, reach out to ${escapeHtml(bakerName)} directly.
      </p>
    `;

    const html = renderReceiptShell({
      docType: "Invoice",
      bakerName,
      bakerUrl,
      metaRowsHtml: [
        metaRow("", escapeHtml(formatDate(new Date().toISOString()))),
        metaRow("Order ID", escapeHtml(order.invoice_code)),
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
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Bakerï <hello@bakeriapp.com>",
        to: customerEmail,
        subject: `Invoice from ${bakerName} — ${formatCents(amountCents)}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Resend send failed for ${customerEmail}: ${res.status} ${errText}`);
      throw new Error("send_failed");
    }

    return new Response(JSON.stringify({ sent: true, email: customerEmail }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
