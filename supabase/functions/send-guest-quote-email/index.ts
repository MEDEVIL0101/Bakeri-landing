import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";
import {
  escapeHtml,
  formatCents,
  formatDate,
  metaRow,
  renderReceiptItemsHtml,
  renderReceiptShell,
} from "../_shared/receiptEmailStyle.ts";

// Sends the "here's your quote, pay here" email for a guest (web, no
// account) custom-order request. Two callers, one function:
//   1. Automatic — trg_fn_marketplace_order_notify's pending_quote ->
//      quote_provided branch, via x-webhook-secret, right after the baker
//      submits a quote.
//   2. Manual — MarketplaceOrderSheet's "Resend Quote Email" button, via the
//      baker's own JWT, for when the guest lost the original email or the
//      baker wants to resend after editing the quote.
//
// Built on receiptEmailStyle.ts's shared shell (2026-08-07) — same
// wordmark/doc-type/meta block/item-row/"Billing and Payment" shape as
// send-invoice-email and the payment receipt, so the whole quote → invoice →
// receipt sequence a guest receives reads as one product.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;
const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type FormAnswer = {
  label?: string;
  fieldType?: string;
  textValue?: string | null;
  choiceValues?: string[] | null;
  photoPaths?: string[] | null;
};

// Shows the buyer exactly what they originally asked for alongside the
// price — today's email just said "quoted $X", with no record of what
// that price was even for beyond the listing's bare name.
//
// Stacked label-above-value, not a two-column table: a nowrap label next to
// a fixed-width value column squeezed the value into a sliver once the
// label got long ("What colour palette and designs did you have in
// mind?"), wrapping short answers like a date into "2026-" / "08-30" on a
// phone-width screen (same fix as baker/pay-quote.html's copy of this).
function renderRequestBlock(answers: FormAnswer[]): string {
  if (!answers.length) return "";
  const rows = answers
    .map((a) => {
      let valueHtml: string;
      if (a.fieldType === "photo" && Array.isArray(a.photoPaths) && a.photoPaths.length > 0) {
        valueHtml = a.photoPaths
          .map((p) => `<img src="${STORAGE_URL}/form-response-photos/${p}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px;margin:2px 6px 2px 0;" />`)
          .join("");
      } else if (Array.isArray(a.choiceValues) && a.choiceValues.length > 0) {
        valueHtml = escapeHtml(a.choiceValues.join(", "));
      } else if (a.textValue && a.textValue.trim()) {
        valueHtml = escapeHtml(a.textValue);
      } else {
        return "";
      }
      return `<div style="padding:6px 0;">
        <div style="color:#A89B8C;font-size:11.5px;">${escapeHtml(a.label)}</div>
        <div style="font-size:13.5px;color:#241712;margin-top:2px;">${valueHtml}</div>
      </div>`;
    })
    .filter(Boolean)
    .join("");
  if (!rows) return "";
  return `
    <div style="margin:18px 0;padding:14px 16px;background:#F7F2E9;border-radius:10px;">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.02em;color:#A89B8C;text-transform:uppercase;margin-bottom:2px;">What you requested</div>
      ${rows}
    </div>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const webhookSecret = req.headers.get("x-webhook-secret");
  const authHeader = req.headers.get("Authorization");
  let requestingUserId: string | null = null;

  if (webhookSecret && webhookSecret === WEBHOOK_SECRET) {
    // automatic path — trusted
  } else if (authHeader) {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    requestingUserId = user.id;
  } else {
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

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, order_name, customer_name, customer_email, user_id, quoted_price, deposit_amount_cents, quote_note, buyer_profile_id, lead_channel, form_responses, invoice_code")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) return json({ error: "Order not found." }, 400);
  if (requestingUserId && order.user_id !== requestingUserId) return json({ error: "Forbidden" }, 403);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Not a guest order." }, 400);
  }
  const customerEmail = (order.customer_email ?? "").trim();
  if (!customerEmail) {
    await logNotification(db, orderId, "guest_quote_provided", "failed", "no_email_on_file");
    return json({ error: "no_email_on_file" }, 400);
  }
  const quotedPrice = Number(order.quoted_price ?? 0);
  if (!(quotedPrice > 0)) return json({ error: "no_amount_due" }, 400);

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

  const payUrl = `https://bakeriapp.com/baker/pay-quote.html?order=${encodeURIComponent(order.id)}`;
  const noteBlock = order.quote_note
    ? `<p style="line-height:1.5;color:#6B5F54;font-style:italic;">"${escapeHtml(order.quote_note)}"</p>`
    : "";

  // Guest checkout: the customer pays exactly the quoted price — Bakeri's
  // service charge comes out of the baker's side instead (see
  // create-guest-quote-payment-intent), so it's never shown or added here.
  const totalCents = Math.round(quotedPrice * 100);

  // When the baker split the quote into a deposit + balance, this email must
  // ask for (and the button must state) the deposit only — the click-through
  // page (baker/pay-quote.html) already only ever charges the deposit here.
  const depositCents = Math.round(Number(order.deposit_amount_cents ?? 0));
  const isSplitQuote = depositCents > 0 && depositCents < totalCents;
  const payNowCents = isSplitQuote ? depositCents : totalCents;
  const payLabel = isSplitQuote ? "Accept Quote and Pay Deposit " : "Accept Quote and Pay ";

  const answers: FormAnswer[] = Array.isArray(order.form_responses) ? order.form_responses : [];
  const requestBlock = renderRequestBlock(answers);

  const itemsHtml = await renderReceiptItemsHtml(db, order.user_id, itemRows, true, totalCents);

  const breakdownRowsHtml = isSplitQuote
    ? `
      <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Deposit</td>
        <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Due now</span></td></tr>
      <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Balance</td>
        <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(totalCents - depositCents)}<br><span style="font-size:11px;font-weight:400;color:#A89B8C;">Due later</span></td></tr>
      <tr><td style="padding:10px 0 0;border-top:1px solid #E4D9C8;font-size:13.5px;color:#6B5F54;">Order total</td>
        <td style="padding:10px 0 0;border-top:1px solid #E4D9C8;text-align:right;font-size:13.5px;color:#241712;">${formatCents(totalCents)}</td></tr>
    `
    : `
      <tr><td style="padding:6px 0;font-size:13.5px;color:#6B5F54;">Order total</td>
        <td style="padding:6px 0;text-align:right;font-size:13.5px;color:#241712;">${formatCents(totalCents)}</td></tr>
    `;

  const footerHtml = `
    <div style="text-align:center;margin:22px 0 10px;">
      <a href="${payUrl}" style="display:inline-block;background:#241712;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;">
        ${payLabel}${formatCents(payNowCents)}
      </a>
    </div>
    <p style="color:#A89B8C;font-size:12px;line-height:1.5;text-align:center;">
      Or copy this link into your browser: ${payUrl}
    </p>
  `;
  const legalHtml = `
    <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;">
      This quote is provided directly by ${escapeHtml(bakerName)}, who is solely
      responsible for preparing and fulfilling your order. Once your payment is
      confirmed, pickup details will be provided by email — you're responsible
      for coordinating pickup with the baker.
    </p>
  `;

  const html = renderReceiptShell({
    docType: "Quote",
    bakerName,
    bakerUrl,
    metaRowsHtml: [
      metaRow("", escapeHtml(formatDate(new Date().toISOString()))),
      metaRow("Order ID", escapeHtml(order.invoice_code || order.id.slice(0, 8).toUpperCase())),
      metaRow("Email", escapeHtml(customerEmail)),
    ].join(""),
    heading: "Your quote is ready",
    itemsHtml,
    afterItemsHtml: noteBlock + requestBlock,
    sectionSubRowHtml: metaRow("", escapeHtml((order.customer_name ?? "").trim() || "Guest")),
    breakdownRowsHtml,
    footerHtml,
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
      to: customerEmail,
      subject: `Your quote from ${bakerName} — ${formatCents(totalCents)}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error(`Resend send failed for ${customerEmail}: ${resendRes.status} ${errText}`);
    await logNotification(db, orderId, "guest_quote_provided", "failed", errText.slice(0, 500));
    return json({ error: "send_failed" }, 400);
  }

  await logNotification(db, orderId, "guest_quote_provided", "sent");
  return json({ ok: true, email: customerEmail });
});
