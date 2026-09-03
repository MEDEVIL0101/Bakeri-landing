// create-connect-account-link
// Creates a Stripe *Standard* connected account for a baker and returns the
// hosted onboarding URL. Called once per baker to set up payments/payouts.
//
// Standard (not Express): the baker is a full independent Stripe customer who
// owns their own dashboard, sets their own payout schedule, and carries their
// own dispute/loss liability. The platform still takes its cut via
// application_fee_amount on direct charges, but pays Stripe no per-account /
// per-payout / volume Connect fees and is not the negative-balance backstop.
// Tap to Pay (Stripe Terminal for Connect) needs Express/Custom and is paused
// — see STRIPE_STANDARD_MIGRATION_PLAN.md.
//
// Onboarding completion is picked up by check-connect-account-status (the
// app's "I've finished on Stripe — check status" button, and the
// bakeri://connect-return deep-link handler), which retrieves the account
// from Stripe and flips stripe_connect_onboarding_complete. stripe-connect-
// webhook is a best-effort secondary and must not be relied on (it has
// silently failed to fire before — see check-connect-account-status's doc).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeConnectCountry } from "../_shared/currency.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate caller is an authenticated baker
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch profile to check for existing Connect account
    const { data: baker, error: bakerError } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete, profile_slug, business_name")
      .eq("id", user.id)
      .single();

    if (bakerError || !baker) {
      return new Response(JSON.stringify({ error: "Baker profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parsed once up front — country is needed before account creation (new
    // accounts only; an existing account's country can't be changed after
    // the fact), returnUrl/refreshUrl are needed for the link regardless.
    // req.json() IS the body — no `.data` wrapper. (A prior version of this
    // line destructured `{ data: body }` off it, which always produced
    // `undefined` since the client never sent a `data` key; it went
    // unnoticed for returnUrl/refreshUrl because their fallback defaults
    // happen to match what the client actually sends, but it silently
    // discarded `country` on every single request.)
    const body = await req.json().catch(() => ({}));
    const country = normalizeConnectCountry((body as Record<string, string>)?.country);

    // Reuse existing account if already created and still actually reachable
    // under this platform's Stripe key — a stale account (e.g. it predates a
    // platform Stripe key change, or the baker disconnected it from their own
    // Stripe dashboard) would otherwise get silently reused here forever,
    // meaning a baker tapping "Connect with Stripe" to fix a broken
    // connection would just recreate the exact same broken account link.
    // See the Sweet Southern Bakery incident this was hand-fixed for.
    let accountId = baker.stripe_connect_account_id;
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
      } catch {
        accountId = null;
      }
    }

    // The baker's storefront URL for Stripe's onboarding "Your website" step.
    // The clean bakeriapp.com/<slug> URL is served as a real pre-generated
    // HTTP 200 page (scripts/generate-storefront-pages.mjs) so Stripe's
    // server-side reachability check passes. Falls back to the ?id= form
    // (also a real 200 via baker/index.html) for a baker with no slug yet.
    // Trailing slash: GitHub Pages 301s "/<slug>" -> "/<slug>/" to serve the
    // directory index; passing the slashed form skips that redirect hop.
    const storeUrl = baker.profile_slug
      ? `https://bakeriapp.com/${encodeURIComponent(baker.profile_slug)}/`
      : `https://bakeriapp.com/baker/?id=${encodeURIComponent(user.id)}`;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "standard",
        // Prefill hints only — a Standard account's holder confirms/edits all
        // of this in Stripe's own hosted onboarding, and manages capabilities
        // and payout schedule themselves afterward. Country still can't change
        // once set, so it's the one that matters to get right up front.
        country,
        email: user.email,
        business_type: "individual",
        business_profile: {
          url: storeUrl,
          name: baker.business_name || undefined,
          mcc: "5462", // Bakeries
          product_description: "Homemade baked goods, cookies, cakes and treats sold directly to local customers.",
        },
      });

      accountId = account.id;

      // Persist immediately so we can reuse on retries
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await serviceClient
        .from("profiles")
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_account_type: "standard",
          country,
        })
        .eq("id", user.id);
    }

    // Generate a fresh account link (they expire in ~15 minutes).
    // Stripe's Account Links API requires real http(s) URLs for refresh_url/
    // return_url — it rejects custom app schemes like bakeri://connect-return
    // outright ("Not a valid URL"). bakeriapp.com/connect-return and
    // /connect-refresh are tiny bridge pages that immediately hand off to the
    // bakeri:// deep link once Stripe lands the browser there.
    const returnUrl  = (body as Record<string, string>)?.returnUrl
      ?? "https://bakeriapp.com/connect-return/";
    const refreshUrl = (body as Record<string, string>)?.refreshUrl
      ?? "https://bakeriapp.com/connect-refresh/";

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return new Response(
      JSON.stringify({ url: accountLink.url, accountId }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("create-connect-account-link error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
