import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Called directly by baker/digital-checkout.html right after
// finalize-guest-digital-order succeeds. The signed download URL(s) are
// already shown inline in the success state — this email is a backup so the
// buyer can find their download(s) later even if they close the tab,
// mirroring send-guest-order-received-email's role for physical orders.
//
// The download_url(s) passed in are the exact same signed URLs the purchase
// flow already got back from finalize-guest-digital-order (created once,
// reused here) — this function does not mint its own, so both the on-page
// link(s) and the emailed one(s) expire at the same time.

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
  // download_url (singular) kept for back-compat with any cached copy of the
  // storefront page still sending the old single-item shape.
  const downloads: { item_name?: string; download_url: string }[] = Array.isArray(body.downloads)
    ? body.downloads
    : body.download_url
    ? [{ download_url: String(body.download_url) }]
    : [];
  if (!orderId || downloads.length === 0) return json({ error: "Invalid request." }, 400);

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

  const linksHtml = downloads
    .map(
      (d) => `
      <a href="${d.download_url}" style="display:block;margin-top:12px;padding:12px 22px;background:#241712;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;text-align:center;">
        ${downloads.length > 1 ? "Download " + escapeHtml(d.item_name || "") : "Download now"}
      </a>`
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
      <h2 style="margin:0 0 8px;">Your download${downloads.length > 1 ? "s are" : " is"} ready</h2>
      <p style="color:#6B5F54;line-height:1.5;">
        Thanks for your purchase from ${escapeHtml(order.baker_display_name || "the baker")} —
        ${escapeHtml(order.order_name || "your item")} ${downloads.length > 1 ? "are" : "is"} ready to download.
      </p>
      ${linksHtml}
      <p style="color:#A89B8C;font-size:12px;margin-top:24px;">${downloads.length > 1 ? "These links" : "This link"} expire${downloads.length > 1 ? "" : "s"} in 7 days. Order reference: ${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}</p>
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
