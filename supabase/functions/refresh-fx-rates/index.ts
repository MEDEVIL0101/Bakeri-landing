// Daily CAD <-> USD rate for the storefront's approximate-price display
// (fx_rates, migration 20261114000003). ECB reference rates via Frankfurter;
// pg_cron "refresh-fx-rates" calls this once a day. Display only — charges are
// always in the shop's own currency. Secret-gated like the other crons.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) return json({ error: "Unauthorized" }, 401);
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=CAD&symbols=USD");
  if (!res.ok) return json({ error: `rates HTTP ${res.status}` }, 502);
  const body = await res.json() as { date?: string; rates?: { USD?: number } };
  const rate = Number(body.rates?.USD);
  // Sanity bounds: never publish a broken rate to every storefront.
  if (!(rate > 0.4 && rate < 1.2)) return json({ error: `implausible rate ${rate}` }, 502);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();
  const { error } = await db.from("fx_rates").upsert([
    { base: "cad", quote: "usd", rate, as_of: body.date ?? null, updated_at: now },
    { base: "usd", quote: "cad", rate: Math.round((1 / rate) * 1e6) / 1e6, as_of: body.date ?? null, updated_at: now },
  ], { onConflict: "base,quote" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, cad_usd: rate, as_of: body.date });
});
