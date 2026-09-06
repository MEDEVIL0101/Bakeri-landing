import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml, formatDate, resolveItemImageUrl } from "../_shared/receiptEmailStyle.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";

// Called right after a digital purchase (finalize-guest-digital-order /
// -digital-physical-order, via the storefront pages) and by
// resend-digital-download. A backup copy of the download links so the buyer
// can find them later even if she closes the tab.
//
// The email mirrors the order line by line: one row per item the buyer
// actually bought, with that listing's photo and its own Download button —
// same row shape as the receipt emails (resolveItemImageUrl). The signed
// URLs are passed in (created once by the caller, reused here) — this
// function does not mint its own, so the on-page and emailed links share an
// expiry. downloads[] is expected already aligned one-per-line, in order;
// pass menu_item_id on each entry where known so the photo resolves without
// a name-match.

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

interface DownloadEntry {
  item_name?: string;
  download_url: string;
  menu_item_id?: string | null;
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
  const downloads: DownloadEntry[] = Array.isArray(body.downloads)
    ? (body.downloads as DownloadEntry[])
    : body.download_url
    ? [{ download_url: String(body.download_url) }]
    : [];
  if (!orderId || downloads.length === 0) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, user_id, order_name, customer_email, baker_display_name, created_at")
    .eq("id", orderId)
    .single();

  if (orderErr || !order || !order.customer_email) {
    console.error("order lookup failed:", orderErr?.message);
    return json({ error: "Order not found." }, 400);
  }

  const bakerId = order.user_id as string;
  const bakerName = (order.baker_display_name || "").trim() || "the baker";
  const multi = downloads.length > 1;

  // One image lookup per line — same resolver the receipt emails use
  // (menu_item_id when known, else an unambiguous name match; null when the
  // listing has no photo).
  const images = await Promise.all(
    downloads.map((d) =>
      resolveItemImageUrl(db, bakerId, {
        custom_name: d.item_name ?? order.order_name ?? "",
        quantity: 1,
        price_per_unit: 0,
        menu_item_id: d.menu_item_id ?? null,
      }).catch(() => null)
    )
  );

  const rowsHtml = downloads
    .map((d, i) => {
      const name = escapeHtml(d.item_name || order.order_name || "Your file");
      const img = images[i]
        ? `<img src="${images[i]}" width="56" height="56" style="width:56px;height:56px;border-radius:10px;object-fit:cover;display:block;" alt="" />`
        : `<div style="width:56px;height:56px;border-radius:10px;background:#F0E9DC;"></div>`;
      return `<tr>
        <td style="width:56px;padding:12px 0;vertical-align:top;">${img}</td>
        <td style="padding:12px 0 12px 12px;vertical-align:top;">
          <div style="font-size:14.5px;font-weight:600;color:#241712;line-height:1.35;">${name}</div>
          <a href="${d.download_url}" style="display:inline-block;margin-top:8px;padding:9px 18px;background:#241712;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;font-size:13px;">Download</a>
        </td>
      </tr>`;
    })
    .join("");

  const ref = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const dateStr = formatDate(order.created_at);

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;background:#fff;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#A89B8C;text-transform:uppercase;">Bakerï</div>
      <h1 style="margin:14px 0 2px;font-size:24px;">Your download${multi ? "s are" : " is"} ready</h1>
      <div style="font-size:15px;margin-bottom:14px;color:#6B5F54;">from <strong style="color:#241712;">${escapeHtml(bakerName)}</strong></div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6B5F54;">
        ${dateStr ? `<tr><td style="padding:2px 0;"><strong style="color:#241712;">Date:</strong> ${escapeHtml(dateStr)}</td></tr>` : ""}
        <tr><td style="padding:2px 0;"><strong style="color:#241712;">Order reference:</strong> ${ref}</td></tr>
      </table>

      <div style="height:1px;background:#E4D9C8;margin:20px 0;"></div>

      <table style="width:100%;border-collapse:collapse;">
        ${rowsHtml}
      </table>

      <div style="height:1px;background:#E4D9C8;margin:20px 0 14px;"></div>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin:0;">
        ${multi ? "These links stay" : "This link stays"} active for a year — save your ${multi ? "files" : "file"} somewhere safe.
        If ${multi ? "they ever stop" : "it ever stops"} working, or anything else about this order needs sorting, just reply to this email — it reaches ${escapeHtml(bakerName)} directly.
      </p>
    </div>
  `;

  const identity = await customerEmailIdentity(db, bakerId, order.baker_display_name);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: identity.from,
      reply_to: identity.reply_to,
      to: order.customer_email,
      subject: `Your download — ${order.order_name || "your purchase"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    console.error("Resend send failed:", await resendRes.text());
    return json({ error: "Email send failed." }, 502);
  }

  return json({ ok: true });
});
