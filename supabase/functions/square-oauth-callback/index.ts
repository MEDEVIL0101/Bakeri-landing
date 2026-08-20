// square-oauth-callback
// Receives the OAuth redirect from Square, exchanges the code for tokens,
// stores them in pos_integrations, then redirects to the bakeri:// deep link.
//
// The `state` param is signed by square-oauth-start and verified below —
// Square just echoes back whatever we sent it, so without verification
// anyone could craft their own authorize URL with state=bakeri:{victim UUID}
// and link their own Square account to someone else's Bakeri account.
//
// Required env vars (set via `supabase secrets set`):
//   SQUARE_APP_ID              — from Square Developer Dashboard
//   SQUARE_APP_SECRET          — from Square Developer Dashboard
//   SQUARE_OAUTH_STATE_SECRET  — must match the one square-oauth-start signs with
//   SUPABASE_URL               — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY  — auto-injected by Supabase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyState } from "../_shared/square-oauth-state.ts";

const SQUARE_APP_ID     = Deno.env.get("SQUARE_APP_ID")!;
const SQUARE_APP_SECRET = Deno.env.get("SQUARE_APP_SECRET")!;
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SQUARE_API        = "https://connect.squareup.com";
const SQUARE_VERSION    = "2024-01-17";
const REDIRECT_URI      = `${SUPABASE_URL}/functions/v1/square-oauth-callback`;

const deepLink = (path: string) =>
  new Response(null, { status: 302, headers: { Location: `bakeri://pos/square/${path}` } });

Deno.serve(async (req: Request) => {
  const url   = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // "{userId}.{expiresAt}.{signature}"
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    console.error("OAuth error or missing params:", { error, hasCode: !!code, hasState: !!state });
    return deepLink("failed");
  }

  const userId = await verifyState(state);
  if (!userId) {
    console.error("OAuth state failed verification (invalid, expired, or tampered)");
    return deepLink("failed");
  }

  // ── 1. Exchange code for tokens ──────────────────────────────────────────────
  const tokenRes = await fetch(`${SQUARE_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({
      client_id:     SQUARE_APP_ID,
      client_secret: SQUARE_APP_SECRET,
      code,
      grant_type:    "authorization_code",
      redirect_uri:  REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    return deepLink("failed");
  }

  const tokens = await tokenRes.json();
  const { access_token, refresh_token, expires_at, merchant_id } = tokens;

  if (!access_token || !merchant_id) {
    console.error("Missing token fields:", tokens);
    return deepLink("failed");
  }

  // ── 2. Fetch merchant info for display name ──────────────────────────────────
  let merchantName = "";
  try {
    const mRes = await fetch(`${SQUARE_API}/v2/merchants/${merchant_id}`, {
      headers: { Authorization: `Bearer ${access_token}`, "Square-Version": SQUARE_VERSION },
    });
    if (mRes.ok) {
      const mData = await mRes.json();
      merchantName = mData.merchant?.business_name ?? "";
    }
  } catch (_) { /* non-fatal */ }

  // ── 3. Fetch locations to find primary location_id ───────────────────────────
  let locationId = "";
  try {
    const lRes = await fetch(`${SQUARE_API}/v2/locations`, {
      headers: { Authorization: `Bearer ${access_token}`, "Square-Version": SQUARE_VERSION },
    });
    if (lRes.ok) {
      const lData = await lRes.json();
      const active = (lData.locations ?? []).find((l: Record<string, string>) => l.status === "ACTIVE");
      locationId = active?.id ?? lData.locations?.[0]?.id ?? "";
    }
  } catch (_) { /* non-fatal */ }

  // ── 4. Upsert into pos_integrations ─────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
  const { error: dbErr } = await supabase
    .from("pos_integrations")
    .upsert(
      {
        user_id:          userId,
        pos_type:         "square",
        access_token,
        refresh_token:    refresh_token ?? null,
        token_expires_at: expires_at   ?? null,
        merchant_id,
        merchant_name:    merchantName,
        location_id:      locationId,
        is_active:        true,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "user_id,pos_type" }
    );

  if (dbErr) {
    console.error("DB upsert failed:", dbErr);
    return deepLink("failed");
  }

  const encodedName = encodeURIComponent(merchantName);
  return deepLink(`connected?merchant=${encodedName}`);
});
