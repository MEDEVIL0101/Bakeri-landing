import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";

// Sends the "your quote is being revised" email for a guest (web, no
// account) custom-order request whose quote the baker retracted. Mirrors
// send-guest-quote-email's dual-caller pattern:
//   1. Automatic — trg_fn_marketplace_order_notify's quote_provided ->
//      pending_quote branch, via x-webhook-secret, right after the baker
//      retracts a quote.
//   2. Manual — a baker's own JWT, for a future "resend" affordance if one
//      gets added.
//
// No payment exists at this stage in either direction, so unlike the
// declined-order webhook this never touches Stripe.

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
    .select("id, order_name, customer_name, customer_email, user_id, buyer_profile_id, lead_channel")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) return json({ error: "Order not found." }, 400);
  if (requestingUserId && order.user_id !== requestingUserId) return json({ error: "Forbidden" }, 403);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Not a guest order." }, 400);
  }
  const customerEmail = (order.customer_email ?? "").trim();
  if (!customerEmail) {
    await logNotification(db, orderId, "guest_quote_retracted", "failed", "no_email_on_file");
    return json({ error: "no_email_on_file" }, 400);
  }

  const { data: baker } = await db
    .from("profiles")
    .select("business_name, user_name, email")
    .eq("id", order.user_id)
    .single();
  const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";
  const identity = await customerEmailIdentity(db, order.user_id, bakerName, baker?.email);

  const firstName = (order.customer_name ?? "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Your quote is being updated</h2>
      <p style="line-height:1.5;">${greeting}</p>
      <p style="line-height:1.5;color:#6B5F54;">
        ${escapeHtml(bakerName)} needs to make a change to the quote for
        <strong>${escapeHtml(order.order_name || "your order")}</strong> and has
        pulled back the one you received. You haven't been charged, and no
        action is needed from you right now — they'll send an updated quote
        soon.
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
      from: identity.from,
      reply_to: identity.reply_to,
      to: customerEmail,
      subject: `Update on your quote from ${bakerName}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error(`Resend send failed for ${customerEmail}: ${resendRes.status} ${errText}`);
    await logNotification(db, orderId, "guest_quote_retracted", "failed", errText.slice(0, 500));
    return json({ error: "send_failed" }, 400);
  }

  await logNotification(db, orderId, "guest_quote_retracted", "sent");
  return json({ ok: true, email: customerEmail });
});
