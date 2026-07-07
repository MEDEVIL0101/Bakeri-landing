import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { VENDOR_ACK_EMAIL_TEMPLATE } from "./template.ts";

// Set RESEND_API_KEY in Dashboard → Edge Functions → Secrets.
// VENDOR_ACK_WEBHOOK_SECRET must match the Vault entry named
// 'vendor_ack_webhook_secret' (see migrations/20260706000008_vendor_ack_secret_setup.sql
// and 20260706000009_vendor_ack_trigger_use_dedicated_secret.sql) — a
// dedicated secret for this feature, not the shared BAKERI_WEBHOOK_SECRET
// used elsewhere, since that one's Vault counterpart doesn't currently exist.
// The notify_vendor_application() trigger reads it and calls this function
// via net.http_post whenever a row is inserted into vendor_applications.
// No Dashboard webhook needed.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET  = Deno.env.get("VENDOR_ACK_WEBHOOK_SECRET")!;

interface VendorApplicationRecord {
  first_name: string;
  bakery_name: string;
  email: string;
  bake_types: string[];
}

interface DatabaseWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: VendorApplicationRecord;
}

// Applicant-supplied strings land straight in this HTML email — escape them
// so a bakery name like "<b>" or "&" can't distort the layout.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-webhook-secret" },
    });
  }

  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "vendor_applications") {
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { first_name, bakery_name, email, bake_types } = payload.record;

  const html = VENDOR_ACK_EMAIL_TEMPLATE
    .replace(/\{\{first_name\}\}/g, escapeHtml(first_name))
    .replace(/\{\{bakery_name\}\}/g, escapeHtml(bakery_name))
    .replace(/\{\{bake_types\}\}/g, escapeHtml((bake_types ?? []).join(", ")));

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Bakerï <hello@bakeriapp.com>",
      to: email,
      subject: "We've got your Bakerï vendor application",
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Resend send failed for ${email}: ${res.status} ${errText}`);
    return new Response(JSON.stringify({ error: "Send failed" }), { status: 502 });
  }

  return new Response(JSON.stringify({ sent: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
