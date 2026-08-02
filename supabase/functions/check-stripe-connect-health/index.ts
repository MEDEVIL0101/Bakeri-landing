import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";

// Runs on a schedule (see the check-stripe-connect-health cron migration) —
// this is the "the app should have caught this" fix for the Sweet Southern
// Bakery incident: their Stripe Connect account was orphaned by a platform
// key switch, and nothing noticed until a real customer's payment failed
// with a raw Stripe error. stripe-connect-webhook only ever flips
// stripe_connect_onboarding_complete to TRUE (on a capability-active event)
// and has no path back to FALSE, and per this codebase's own history
// (20260714000015's comment) that webhook has already silently failed to
// fire for a real account once before — so a periodic sweep is the actual
// safety net, not a webhook that assumes perfect delivery.
//
// Every baker currently marked ready-to-accept-payments gets re-verified
// against Stripe directly; anyone whose account is unreachable or has lost
// its charge capability gets flipped back to onboarding-incomplete, which
// makes their storefront immediately show "hasn't finished setting up
// payments yet" instead of letting a customer hit a checkout failure. The
// baker also gets an in-app notification so they find out from us, not
// from a customer complaint.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

const stripe = getStripeClient();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: bakers, error } = await db
    .from("profiles")
    .select("id, business_name, user_name, stripe_connect_account_id")
    .eq("stripe_connect_onboarding_complete", true)
    .not("stripe_connect_account_id", "is", null);

  if (error) {
    console.error("check-stripe-connect-health: profiles fetch failed:", error.message);
    return json({ error: "Could not load bakers." }, 500);
  }

  const suspended: { baker_id: string; account_id: string; reason: string }[] = [];

  for (const baker of bakers ?? []) {
    let reason: string | null = null;
    try {
      const account = await stripe.accounts.retrieve(baker.stripe_connect_account_id!);
      if (!account.charges_enabled) reason = "charges_disabled";
    } catch (err: unknown) {
      reason = err instanceof Error ? err.message : "unreachable";
    }

    if (!reason) continue;

    const { error: updateErr } = await db
      .from("profiles")
      .update({ stripe_connect_onboarding_complete: false })
      .eq("id", baker.id)
      .eq("stripe_connect_account_id", baker.stripe_connect_account_id); // no-op if it changed mid-sweep

    if (updateErr) {
      console.error(`check-stripe-connect-health: failed to suspend ${baker.id}:`, updateErr.message);
      continue;
    }

    suspended.push({ baker_id: baker.id, account_id: baker.stripe_connect_account_id!, reason });

    const bakerName = baker.business_name?.trim() || baker.user_name?.trim() || "Baker";
    const { error: notifyErr } = await db.rpc("send_marketplace_notification", {
      p_recipient_user_id: baker.id,
      p_title: "⚠️ Payments Paused",
      p_body: "Your Stripe connection needs attention — reconnect it in Settings to start accepting orders again.",
      p_data: { type: "stripe_connect_suspended" },
    });
    if (notifyErr) {
      console.error(`check-stripe-connect-health: notify failed for ${bakerName} (${baker.id}):`, notifyErr.message);
    }
  }

  return json({ checked: (bakers ?? []).length, suspended });
});
