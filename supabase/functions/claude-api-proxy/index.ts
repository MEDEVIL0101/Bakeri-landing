import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Proxies Claude API calls (recipe-scan-from-photo, form-import) that used to
// go straight from the device to api.anthropic.com with a hardcoded API key
// baked into the client (RecipeAIService.swift, FormImportAI.swift) —
// pulled out of the binary because a secret key embedded in a shipped app is
// trivially extractable via `strings` on the IPA, letting anyone who
// downloads the app run unlimited requests against Diana's Anthropic
// account. The key now lives only here, server-side.
//
// Requires a signed-in Bakeri user (same auth pattern as get-baker-payout-
// summary etc.) — these AI features are only ever reachable from inside the
// app for an authenticated baker, never from a guest/anonymous context.
// Pass-through of {model, max_tokens, messages} to Anthropic's Messages API,
// returning its response body verbatim so the client's existing parsing
// (content[0].text) needs no changes beyond the endpoint + auth header.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
// Only the two models/flows this proxy actually serves — closes off a
// modified client picking an arbitrary (pricier) model or an unbounded
// max_tokens to run up Diana's Anthropic bill.
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6"]);
const MAX_TOKENS_CEILING = 8192;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const { model, max_tokens, messages } = await req.json();

    if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) {
      return json({ error: "Unsupported model" }, 400);
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "No messages" }, 400);
    }
    const boundedMaxTokens = Math.min(
      typeof max_tokens === "number" && max_tokens > 0 ? max_tokens : MAX_TOKENS_CEILING,
      MAX_TOKENS_CEILING
    );

    const anthropicResponse = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: boundedMaxTokens, messages }),
    });

    const responseBody = await anthropicResponse.text();
    return new Response(responseBody, {
      status: anthropicResponse.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
