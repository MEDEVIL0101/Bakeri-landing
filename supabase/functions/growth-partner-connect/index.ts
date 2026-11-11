// growth-partner-connect
// A Community Growth Partner's payout account. Partners don't sell, so they
// get a Stripe Express account that only receives transfers (vendors use
// Standard accounts via create-connect-account-link). The monthly
// release-referral-payouts sweep pays them from growth_partners.
//
//   { action: "onboard", returnUrl? }  → { url }  (creates the account first if needed)
//   { action: "status" }               → { ready, details_submitted, requirements }
//   { action: "dashboard" }            → { url }  (Express dashboard login link)
//
// Auth: the partner's own JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { normalizeConnectCountry } from "../_shared/currency.ts";

const stripe = getStripeClient();
const PLATFORM_COUNTRY = "CA";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: gp } = await db.from("growth_partners").select("*").eq("user_id", user.id).maybeSingle();
  if (!gp) return json({ error: "Not a Growth Partner" }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, string>;
  const action = body.action ?? "status";

  try {
    let accountId: string | null = gp.stripe_connect_account_id;
    if (accountId) {
      try { await stripe.accounts.retrieve(accountId); } catch { accountId = null; }
    }

    if (action === "onboard") {
      if (gp.status !== "active") return json({ error: "Your partnership is paused. Contact hello@bakeriapp.com." }, 403);
      if (!accountId) {
        const country = normalizeConnectCountry(body.country ?? gp.country);
        const account = await stripe.accounts.create({
          type: "express",
          country,
          email: gp.email,
          business_type: "individual",
          capabilities: { transfers: { requested: true } },
          // Outside Canada a payouts-only account uses the recipient agreement.
          ...(country !== PLATFORM_COUNTRY ? { tos_acceptance: { service_agreement: "recipient" } } : {}),
          business_profile: {
            mcc: "7311",
            product_description: "Referral partner introducing small food businesses to Bakerï. Receives referral commission only.",
            url: "https://bakeriapp.com/community-growth-partners.html",
          },
          metadata: { kind: "growth_partner", user_id: user.id },
        });
        accountId = account.id;
        await db.from("growth_partners").update({
          stripe_connect_account_id: accountId, stripe_connect_onboarding_complete: false,
          country, updated_at: new Date().toISOString(),
        }).eq("user_id", user.id);
      }
      const back = body.returnUrl ?? "https://bakeriapp.com/app/partner/payouts?connected=1";
      const link = await stripe.accountLinks.create({
        account: accountId, refresh_url: back, return_url: back, type: "account_onboarding",
      });
      return json({ url: link.url });
    }

    if (!accountId) return json({ ready: false, has_account: false });

    const acct = await stripe.accounts.retrieve(accountId);
    const ready = acct.payouts_enabled === true && acct.capabilities?.transfers === "active";
    if (ready !== gp.stripe_connect_onboarding_complete) {
      await db.from("growth_partners").update({
        stripe_connect_onboarding_complete: ready, updated_at: new Date().toISOString(),
      }).eq("user_id", user.id);
    }

    if (action === "dashboard") {
      const login = await stripe.accounts.createLoginLink(accountId);
      return json({ url: login.url });
    }

    return json({
      ready,
      has_account: true,
      details_submitted: acct.details_submitted === true,
      currently_due: acct.requirements?.currently_due ?? [],
      disabled_reason: acct.requirements?.disabled_reason ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("growth-partner-connect:", action, message);
    return json({ error: message }, 500);
  }
});
