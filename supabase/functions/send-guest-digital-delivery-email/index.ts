import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Called directly by baker/index.html's digital-purchase sheet right after
// finalize-guest-digital-order succeeds. The signed download URL is already
// shown inline in the success state — this email is a backup so the buyer
// can find their download later even if they close the tab, mirroring
// send-guest-order-received-email's role for physical orders.
//
// The download_url passed in is the exact same signed URL the purchase flow
// already got back from finalize-guest-digital-order (created once, reused
// here) — this function does not mint its own, so both the on-page link and
// the emailed one expire at the same time.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  const downloadUrl = String(body.download_url ?? "").trim();
  if (!orderId || !downloadUrl) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, order_name, customer_email, baker_display_name")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    return json({ error: "Order not found." }, 400);
  }

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Your download is ready</h2>
      <p style="color:#6B5F54;line-height:1.5;">
        Thanks for your purchase from ${escapeHtml(order.baker_display_name || "the baker")} —
        ${escapeHtml(order.order_name || "your item")} is ready to download.
      </p>
      <a href="${downloadUrl}" style="display:inline-block;margin-top:16px;padding:12px 22px;background:#241712;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;">
        Download now
      </a>
      <p style="color:#A89B8C;font-size:12px;margin-top:24px;">This link expires in 7 days. Order reference: ${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}</p>
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
      to: order.customer_email,
      subject: `Your download — ${order.order_name || "your purchase"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    console.error("Resend send failed:", await resendRes.text());
  }

  return json({ ok: true });
});

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
