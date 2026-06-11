import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Set SIGNUP_HOOK_SECRET in Edge Function secrets (Dashboard → Edge Functions → Secrets).
// Configure the same value in Dashboard → Authentication → Hooks → signup → Secret.
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET      = Deno.env.get("SIGNUP_HOOK_SECRET");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization" },
    });
  }

  // Reject calls that don't carry the shared secret.
  if (!HOOK_SECRET) {
    console.error("SIGNUP_HOOK_SECRET is not set");
    return new Response(JSON.stringify({ error: "Hook not configured" }), { status: 500 });
  }
  const bearer = req.headers.get("authorization") ?? "";
  if (bearer !== `Bearer ${HOOK_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  // Supabase sends the user object directly or nested under a "user" key.
  const user = (payload.user as Record<string, unknown>) ?? payload;
  const userId = user.id as string | undefined;
  if (!userId) {
    // Unknown payload shape — pass through unchanged so auth isn't blocked.
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Cloudflare sets cf-connecting-ip to the actual client IP even when the
  // request passes through Supabase's infrastructure.
  const rawIp = req.headers.get("cf-connecting-ip") ??
               req.headers.get("x-real-ip") ??
               (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip = rawIp || null;

  const countryCode = req.headers.get("cf-ipcountry") ?? null;
  const userAgent   = req.headers.get("user-agent") ?? null;

  const appMeta = (user.app_metadata ?? user.raw_app_meta_data ?? {}) as Record<string, unknown>;
  const provider = (appMeta.provider as string) ?? null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { error } = await admin.from("registration_events").upsert(
    {
      user_id:      userId,
      email:        (user.email as string) ?? null,
      ip_address:   ip,
      country_code: countryCode,
      user_agent:   userAgent,
      provider,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("Failed to log registration event:", error.message);
    // Don't block signup — just log the failure.
  }

  // Auth hooks must return the payload unchanged (or modified if you're using
  // it to enrich user metadata).  Return it regardless of logging success.
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
});
