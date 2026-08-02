// check-connect-account-status
// On-demand, synchronous ground-truth check of a baker's Stripe Connect
// account — called from the app's "I've finished on Stripe — check status"
// button instead of just re-reading the DB flag.
//
// stripe-connect-webhook is the only other thing that ever flips
// stripe_connect_onboarding_complete to true, and it depends on Stripe
// actually delivering V2 thin capability events for this account. That has
// already silently failed at least once for a real baker (see migration
// 20260714000015 — Tilly's Sugar Cookies genuinely finished onboarding but
// the webhook never processed it, and had to be hand-fixed with a one-off
// UPDATE). This function closes that gap by asking Stripe directly, using
// the same fields that were used to confirm Tilly's account by hand:
// charges_enabled, payouts_enabled, details_submitted.
//
// Two callers:
//   - The app, with the baker's own session JWT (self-check).
//   - An internal caller using the x-admin-secret header (BAKERI_ADMIN_CHECK_SECRET)
//     + { bakerId } in the body (admin/diagnostic use — e.g. unblocking a
//     specific baker without waiting for them to retry in the app).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_CHECK_SECRET = Deno.env.get("BAKERI_ADMIN_CHECK_SECRET") ?? "";

const stripe = getStripeClient();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const adminSecret = req.headers.get("x-admin-secret");
    const body = await req.json().catch(() => ({}));
    const requestedBakerId = (body as Record<string, string>)?.bakerId;

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let bakerId: string;
    if (adminSecret && ADMIN_CHECK_SECRET && adminSecret === ADMIN_CHECK_SECRET && requestedBakerId) {
      // Admin/diagnostic path — trusted caller checking a specific baker.
      bakerId = requestedBakerId;
    } else {
      // Normal self-check path — caller checking their own account.
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) return json({ error: "Unauthorized" }, 401);
      bakerId = user.id;
    }

    const { data: baker, error: bakerError } = await serviceClient
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete")
      .eq("id", bakerId)
      .single();

    if (bakerError || !baker) return json({ error: "Baker profile not found" }, 404);

    if (!baker.stripe_connect_account_id) {
      return json({ complete: false, accountId: null, reason: "not_started" });
    }

    const account = await stripe.accounts.retrieve(baker.stripe_connect_account_id);
    const complete = Boolean(
      account.charges_enabled && account.payouts_enabled && account.details_submitted
    );

    if (complete && !baker.stripe_connect_onboarding_complete) {
      await serviceClient
        .from("profiles")
        .update({ stripe_connect_onboarding_complete: true })
        .eq("id", bakerId)
        .eq("stripe_connect_account_id", baker.stripe_connect_account_id);
    }

    return json({
      complete,
      accountId: baker.stripe_connect_account_id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      currentlyDue: account.requirements?.currently_due ?? [],
    });
  } catch (err) {
    console.error("check-connect-account-status error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
