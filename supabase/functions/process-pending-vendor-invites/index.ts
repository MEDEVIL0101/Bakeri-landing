import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { VENDOR_INVITE_EMAIL_TEMPLATE } from "./template.ts";

// Cron-invoked (x-webhook-secret, verify_jwt off — same shape as
// expire-overdue-guest-orders) every minute by the
// process-pending-vendor-invites pg_cron job
// (20260809000001_vendor_invite_automation.sql). Automates what was, until
// today, a fully manual step: a baker reviewing supabase.com/dashboard for
// new vendor_applications rows, then running send_new_vendor_invites.sh by
// hand. Deliberately waits 5 minutes past created_at before sending (not
// instant on insert, unlike send-vendor-ack-email's immediate "we got your
// application" receipt) — a short buffer the baker asked for before an
// applicant automatically gets full app access, with no other review step.
//
// Only flips status to 'contacted' / logs to beta_invites_sent on an actual
// successful send — a failed row stays 'pending' and just gets retried on
// the next run, same self-healing shape as mark-order-ready-for-pickup's
// retry logic (see that function's history earlier the same week for why
// silently swallowing a failed send is the thing to avoid here).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pending, error: fetchErr } = await db
    .from("vendor_applications")
    .select("id, email, first_name, bakery_name, created_at")
    .eq("status", "pending")
    .lte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

  if (fetchErr) {
    console.error("Fetching pending vendor_applications failed:", fetchErr.message);
    return json({ error: fetchErr.message }, 500);
  }

  let sent = 0;
  let failed = 0;

  for (const app of pending ?? []) {
    try {
      const html = VENDOR_INVITE_EMAIL_TEMPLATE.replace(/\{\{name\}\}/g, escapeHtml(app.first_name || "there"));

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Bakerï <hello@bakeriapp.com>",
          to: app.email,
          subject: "You're in — Bakerï Access, By Application Only",
          html,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Resend send failed for ${app.email}:`, res.status, errText.slice(0, 500));
        failed++;
        continue;
      }

      // Best-effort — the email already sent, so a logging hiccup shouldn't
      // make this applicant get re-sent the same email on the next run.
      // (status update below is what actually prevents a re-send; these two
      // are secondary bookkeeping.)
      await db.from("beta_invites_sent").insert({ email: app.email, name: app.first_name, sent_at: new Date().toISOString() });
      await db.from("vendor_applications").update({ status: "contacted" }).eq("id", app.id);

      sent++;
    } catch (err) {
      console.error(`Unexpected error processing ${app.email}:`, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return json({ ok: true, checked: (pending ?? []).length, sent, failed });
});
