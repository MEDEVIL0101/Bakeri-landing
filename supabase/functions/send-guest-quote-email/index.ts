import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends the "here's your quote, pay here" email for a guest (web, no
// account) custom-order request. Two callers, one function:
//   1. Automatic — trg_fn_marketplace_order_notify's pending_quote ->
//      quote_provided branch, via x-webhook-secret, right after the baker
//      submits a quote.
//   2. Manual — MarketplaceOrderSheet's "Resend Quote Email" button, via the
//      baker's own JWT, for when the guest lost the original email or the
//      baker wants to resend after editing the quote.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

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

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    .select("id, order_name, customer_name, customer_email, user_id, quoted_price, quote_note, buyer_profile_id, lead_channel")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) return json({ error: "Order not found." }, 400);
  if (requestingUserId && order.user_id !== requestingUserId) return json({ error: "Forbidden" }, 403);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Not a guest order." }, 400);
  }
  const customerEmail = (order.customer_email ?? "").trim();
  if (!customerEmail) return json({ error: "no_email_on_file" }, 400);
  const quotedPrice = Number(order.quoted_price ?? 0);
  if (!(quotedPrice > 0)) return json({ error: "no_amount_due" }, 400);

  const { data: baker } = await db
    .from("profiles")
    .select("business_name, user_name")
    .eq("id", order.user_id)
    .single();
  const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";

  const payUrl = `https://bakeriapp.com/baker/pay-quote.html?order=${encodeURIComponent(order.id)}`;
  const amount = `$${quotedPrice.toFixed(2)}`;
  const firstName = (order.customer_name ?? "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const noteBlock = order.quote_note
    ? `<p style="line-height:1.5;color:#6B5F54;"><em>"${escapeHtml(order.quote_note)}"</em></p>`
    : "";

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Your quote is ready</h2>
      <p style="line-height:1.5;">${greeting}</p>
      <p style="line-height:1.5;color:#6B5F54;">
        ${escapeHtml(bakerName)} has quoted <strong>${amount}</strong> for
        ${escapeHtml(order.order_name || "your order")}.
      </p>
      ${noteBlock}
      <div style="text-align:center;margin:28px 0;">
        <a href="${payUrl}" style="display:inline-block;background:#241712;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;">
          Pay ${amount}
        </a>
      </div>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;">
        Or copy this link into your browser: ${payUrl}
      </p>
    </div>
  `;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Bakerï <hello@bakeriapp.com>",
      to: customerEmail,
      subject: `Your quote from ${bakerName} — ${amount}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error(`Resend send failed for ${customerEmail}: ${resendRes.status} ${errText}`);
    return json({ error: "send_failed" }, 400);
  }

  return json({ ok: true, email: customerEmail });
});
