// send-connect-migration-email
// One-off ops broadcast for the Stripe Connect Express -> Standard migration
// (see STRIPE_STANDARD_MIGRATION_PLAN.md). Tells every baker their payout
// account is being upgraded to a full Stripe account and they'll need to
// (re)connect once to keep selling.
//
// Auth: internal only — x-webhook-secret header matching BAKERI_WEBHOOK_SECRET,
// same convention as release-baker-payouts / check-stripe-connect-health.
//
// Safe by default: DRY RUN unless the body has { "send": true }. A dry run
// returns the exact recipient list (baker id + resolved email + whether they
// had a Connect account) so the list can be eyeballed before anything goes
// out. Mirrors resend-digital-download's dry_run pattern.
//
// Recipients: every profile that is a seller — has a Connect account already,
// or has published a storefront (profile_slug). Override with an explicit
// { "baker_ids": ["uuid", ...] }.
//
// Env: RESEND_API_KEY, BAKERI_WEBHOOK_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveBakerEmail } from "../_shared/bakerEmail.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Dedicated secret rather than the shared BAKERI_WEBHOOK_SECRET — this is a
// one-off ops broadcast, not part of the regular webhook/cron surface those
// other functions share, so it gets its own so rotating one never touches
// the other.
const WEBHOOK_SECRET = Deno.env.get("SEND_CONNECT_MIGRATION_EMAIL_SECRET") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildCorrectionHtml(bakerName: string): string {
  const greeting = bakerName ? `Hi ${esc(bakerName)},` : "Hi there,";
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;background:#fff;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#A89B8C;text-transform:uppercase;">Bakerï</div>
      <h1 style="margin:14px 0 10px;font-size:24px;">Ignore that last email &mdash; your store is fine</h1>

      <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${greeting}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
        A little while ago you got an email saying you'd need to reconnect Stripe
        to keep taking orders. That went out too early &mdash; please disregard it.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
        <strong>Nothing has changed on your end.</strong> Your store is open, your
        payments and payouts are working exactly as before, and there is nothing
        you need to do right now.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
        We are still planning to move everyone to a fuller Stripe setup, but it
        will be a smooth, one-tap switch inside the app with no downtime for your
        store &mdash; and we'll send clear instructions when it's ready. Sorry for
        the confusion.
      </p>

      <div style="height:1px;background:#E4D9C8;margin:22px 0 14px;"></div>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin:0;">
        Questions? Just reply to this email.
      </p>
    </div>
  `;
}

function buildHtml(bakerName: string, hadAccount: boolean): string {
  const greeting = bakerName ? `Hi ${esc(bakerName)},` : "Hi there,";
  const actionLine = hadAccount
    ? "Your current payout connection will stop working, so you'll need to reconnect Stripe once to keep taking orders."
    : "You'll need to connect Stripe once before you can start taking orders.";
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;background:#fff;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#A89B8C;text-transform:uppercase;">Bakerï</div>
      <h1 style="margin:14px 0 10px;font-size:24px;">We're upgrading your Stripe account</h1>

      <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${greeting}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
        We're moving Bakerï payouts over to a full Stripe account for every baker.
        You'll get your own Stripe dashboard, control of your own payout schedule
        and instant payouts, and a simpler, more complete setup overall.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${actionLine}</p>

      <div style="margin:18px 0;padding:14px 16px;background:#F7F2E9;border-radius:10px;font-size:14px;line-height:1.6;">
        <strong>What to do:</strong> open the Bakerï app and go to
        <strong>Settings &rarr; Banking &amp; Payments &rarr; Connect with Stripe</strong>.
        It takes about two minutes.
      </div>

      <p style="font-size:14px;line-height:1.6;margin:0 0 4px;color:#6B5F54;">
        Your storefront will show as not accepting orders until you've reconnected.
      </p>

      <div style="height:1px;background:#E4D9C8;margin:22px 0 14px;"></div>
      <p style="color:#A89B8C;font-size:12px;line-height:1.5;margin:0;">
        Questions? Just reply to this email.
      </p>
    </div>
  `;
}

serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET || !WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const send = body?.send === true;
  const isCorrection = body?.variant === "correction";
  const overrideIds: string[] | null = Array.isArray(body?.baker_ids) ? body.baker_ids : null;

  let query = supabase
    .from("profiles")
    .select("id, user_name, business_name, email, stripe_connect_account_id, stripe_connect_express_account_id_legacy, profile_slug");
  if (overrideIds) {
    query = query.in("id", overrideIds);
  } else {
    query = query.or("stripe_connect_account_id.not.is.null,stripe_connect_express_account_id_legacy.not.is.null,profile_slug.not.is.null");
  }

  const { data: bakers, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: { baker_id: string; email: string | null; had_account: boolean; sent: boolean; error?: string }[] = [];

  for (const baker of bakers ?? []) {
    const email = await resolveBakerEmail(supabase, baker.id, baker.email);
    // Same reasoning: check both columns, since the reset moves the id from
    // one to the other rather than clearing it outright.
    const hadAccount = !!(baker.stripe_connect_account_id || baker.stripe_connect_express_account_id_legacy);
    const name = (baker.business_name || baker.user_name || "").trim();

    if (!email) {
      results.push({ baker_id: baker.id, email: null, had_account: hadAccount, sent: false, error: "no email on file" });
      continue;
    }
    if (!send) {
      results.push({ baker_id: baker.id, email, had_account: hadAccount, sent: false });
      continue;
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: "Bakerï <hello@bakeriapp.com>",
          to: email,
          subject: isCorrection
            ? "Correction: no action needed — your Bakerï store is fine"
            : "Action needed: reconnect Stripe to keep selling on Bakerï",
          html: isCorrection ? buildCorrectionHtml(name) : buildHtml(name, hadAccount),
        }),
      });
      if (!res.ok) {
        results.push({ baker_id: baker.id, email, had_account: hadAccount, sent: false, error: await res.text() });
      } else {
        results.push({ baker_id: baker.id, email, had_account: hadAccount, sent: true });
      }
    } catch (err) {
      results.push({
        baker_id: baker.id, email, had_account: hadAccount, sent: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify({
      dry_run: !send,
      total: results.length,
      sent: results.filter((r) => r.sent).length,
      recipients: results,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
