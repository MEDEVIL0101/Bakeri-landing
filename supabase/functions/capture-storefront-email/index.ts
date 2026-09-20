import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint — a visitor on a baker's storefront
// (popup / inline card / persistent header button, see StorefrontBlockType
// .emailCapture) joins that baker's mailing list. Writes land in
// baker_contacts, source-tagged by which surface captured them.
//
// Routed through this function rather than a direct RLS anon-INSERT policy
// — same established convention as submit-vendor-application (see
// 20260706000011_vendor_applications_via_function.sql, which REVOKED a
// direct-insert policy specifically because real validation and rate
// limiting can't be expressed in a CHECK constraint alone). No captcha here
// (unlike submit-custom-order-inquiry / submit-vendor-application) — a
// mailing-list join is a much lower-value abuse target than a vendor
// application or a custom-order lead, so plain email-format validation +
// a generous per-IP rate limit is the proportionate bar; revisit if real
// abuse shows up.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SOURCES = new Set(["popup", "inline", "header", "lead_magnet"]);
const MAX_NAME_LENGTH = 200;
const RATE_LIMIT_PER_HOUR = 8;

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

function getClientIp(req: Request): string | null {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const bakerID = String(body.user_id ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, MAX_NAME_LENGTH) || null;
  const source = String(body.source ?? "").trim();

  if (!UUID_RE.test(bakerID)) return json({ error: "Invalid request." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!VALID_SOURCES.has(source)) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Confirm the baker actually exists — a bad/stale user_id from a cached
  // storefront page should fail quietly rather than create an orphaned
  // contact row with no owner to ever see it.
  const { data: baker } = await db.from("profiles").select("id").eq("id", bakerID).maybeSingle();
  if (!baker) return json({ error: "Baker not found." }, 404);

  const ip = getClientIp(req);
  if (ip) {
    const { count } = await db
      .from("email_capture_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json({ error: "Too many signups from this connection recently. Please try again later." }, 429);
    }
    await db.from("email_capture_attempts").insert({ ip_address: ip });
  }

  // Upsert: a repeat signup (including one from a previously-unsubscribed
  // contact) clears unsubscribed_at rather than erroring on the unique
  // (user_id, email) constraint.
  const { error } = await db
    .from("baker_contacts")
    .upsert(
      {
        user_id: bakerID,
        email,
        name,
        source,
        unsubscribed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,email" }
    );

  if (error) {
    console.error("baker_contacts upsert failed:", error.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }

  return json({ ok: true });
});
