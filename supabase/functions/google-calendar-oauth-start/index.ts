// google-calendar-oauth-start
// Builds a Google OAuth authorize URL with a signed, expiring state param.
// Called from the iOS app (baker's client) right before opening the Google
// connect flow — mirrors square-oauth-start.
//
// POST (no body required)
// Auth: Bearer {baker's Supabase JWT}
//
// Required env vars:
//   GOOGLE_CLIENT_ID           — from Google Cloud Console OAuth client
//   GOOGLE_OAUTH_STATE_SECRET  — random secret, `openssl rand -hex 32`; must
//                                 match the one google-calendar-oauth-callback verifies with
//   SUPABASE_URL               — auto-injected
//   SUPABASE_ANON_KEY          — auto-injected (used for JWT verification)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "../_shared/google-oauth-state.ts";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;

const STATE_TTL_SECONDS = 10 * 60; // baker has 10 minutes to complete the Google consent screen

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

  const callbackURI = `${SUPABASE_URL}/functions/v1/google-calendar-oauth-callback`;
  const authorizeURL = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeURL.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  // Full calendar scope (not just .../calendar.events) — creating the dedicated
  // "Bakeri Schedule" secondary calendar on connect requires calendars.insert.
  authorizeURL.searchParams.set("scope", "https://www.googleapis.com/auth/calendar");
  authorizeURL.searchParams.set("redirect_uri", callbackURI);
  authorizeURL.searchParams.set("state", state);
  authorizeURL.searchParams.set("response_type", "code");
  // offline + consent guarantees a refresh_token even if the baker previously
  // authorized this app (Google otherwise omits it on repeat consent).
  authorizeURL.searchParams.set("access_type", "offline");
  authorizeURL.searchParams.set("prompt", "consent");

  return new Response(JSON.stringify({ url: authorizeURL.toString() }), {
    headers: { "Content-Type": "application/json" },
  });
});
