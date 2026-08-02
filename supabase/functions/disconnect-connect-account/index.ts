import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a baker manually detach their Stripe Connect account from Settings
// (BankingPaymentsView's "Disconnect Stripe" button) so they can link a
// different one — e.g. the account was set up wrong, or belongs to the
// wrong business. Only ever writes profiles; the Stripe-side account itself
// is left alone (not deleted/deauthorized) since it's a platform-created
// Express account, not something the baker owns independently — there's
// nothing on Stripe's side that needs cleaning up.
//
// Deliberately nulls stripe_connect_account_id (not just
// onboarding_complete): create-connect-account-link reuses an existing
// account id if it's still reachable on Stripe, so leaving the old id in
// place would silently relink the same account the baker just chose to
// walk away from instead of creating a genuinely new one.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error: updateErr } = await serviceClient
    .from("profiles")
    .update({
      stripe_connect_account_id: null,
      stripe_connect_onboarding_complete: false,
    })
    .eq("id", user.id);

  if (updateErr) {
    console.error("disconnect-connect-account update failed:", updateErr.message);
    return json({ error: "Could not disconnect." }, 500);
  }

  return json({ ok: true });
});
