// square-oauth-start
// Builds a Square OAuth authorize URL with a signed, expiring state param.
// Called from the iOS app (baker's client) right before opening the Square
// connect flow — replaces client-built state, which had no way to prove the
// UUID inside it actually belonged to the requesting session.
//
// POST (no body required)
// Auth: Bearer {baker's Supabase JWT}
//
// Required env vars:
//   SQUARE_APP_ID              — from Square Developer Dashboard
//   SQUARE_OAUTH_STATE_SECRET  — random secret, `openssl rand -hex 32`; must
//                                 match the one square-oauth-callback verifies with
//   SUPABASE_URL               — auto-injected
//   SUPABASE_ANON_KEY          — auto-injected (used for JWT verification)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "../_shared/square-oauth-state.ts";

const SQUARE_APP_ID    = Deno.env.get("SQUARE_APP_ID")!;
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;

const STATE_TTL_SECONDS = 10 * 60; // baker has 10 minutes to complete the Square consent screen

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const state = await signState(user.id, expiresAt);

  const callbackURI = `${SUPABASE_URL}/functions/v1/square-oauth-callback`;
  const authorizeURL = new URL("https://connect.squareup.com/oauth2/authorize");
  authorizeURL.searchParams.set("client_id", SQUARE_APP_ID);
  authorizeURL.searchParams.set("scope", "ORDERS_WRITE ORDERS_READ ITEMS_READ MERCHANT_PROFILE_READ");
  authorizeURL.searchParams.set("redirect_uri", callbackURI);
  authorizeURL.searchParams.set("state", state);
  authorizeURL.searchParams.set("session", "false");

  return new Response(JSON.stringify({ url: authorizeURL.toString() }), {
    headers: { "Content-Type": "application/json" },
  });
});
