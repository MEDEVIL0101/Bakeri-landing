import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DISPOSABLE_EMAIL_DOMAINS } from "./disposable-domains.ts";

// Public, unauthenticated endpoint for the "For Bakers" marketing site
// (bakeriapp.com). Replaces a direct anon-key insert into vendor_applications
// so that email-quality checks (disposable-domain blocklist, MX-record
// lookup) and IP rate limiting can be enforced server-side, using the real
// client IP seen on this first hop — not the field-derived value PostgREST
// would see if the insert came from an intermediary. Table grants restrict
// INSERT to service_role only; this function is the only writer.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\s]{7,20}$/;
const RATE_LIMIT_PER_24H = 3;

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

// Domain has no mail exchanger at all — a strong signal the address is
// fabricated (e.g. "Ihopethiscompanyfails.com") rather than a real, if
// obscure, business inbox. Fails open (treated as valid) on lookup errors
// so an outage in Cloudflare's DNS-over-HTTPS service never blocks real
// applicants.
async function hasMxRecord(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!res.ok) return true;
    const data = await res.json();
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch (err) {
    console.error(`MX lookup failed for ${domain}:`, err);
    return true;
  }
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

  const bakery_name = String(body.bakery_name ?? "").trim();
  const first_name = String(body.first_name ?? "").trim();
  const last_name = String(body.last_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const social_url = String(body.social_url ?? "").trim();
  const bake_types = Array.isArray(body.bake_types) ? body.bake_types : [];
  const attest_self_made = body.attest_self_made === true;
  const attest_compliant = body.attest_compliant === true;

  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!PHONE_RE.test(phone)) return json({ error: "Please enter a valid phone number." }, 400);

  const domain = email.split("@")[1];

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return json({ error: "Please use your regular business or personal email, not a disposable address." }, 400);
  }

  if (!(await hasMxRecord(domain))) {
    return json({ error: "We couldn't find a mail server for that email domain. Please double-check your email address." }, 400);
  }

  const clientIp = getClientIp(req);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (clientIp) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await db
      .from("vendor_applications")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", clientIp)
      .gte("created_at", since);

    if (!countErr && (count ?? 0) >= RATE_LIMIT_PER_24H) {
      return json({ error: "Too many applications submitted recently. Please try again later." }, 429);
    }
  }

  const { error } = await db.from("vendor_applications").insert({
    bakery_name,
    first_name,
    last_name,
    email,
    phone,
    bake_types,
    social_url,
    attest_self_made,
    attest_compliant,
    ip_address: clientIp,
  });

  if (error) {
    if (error.code === "23505") {
      // Duplicate email: they've already applied — treat as success.
      return json({ ok: true });
    }
    console.error("vendor_applications insert failed:", error.message);
    return json({ error: "Something went wrong. Please check your details and try again." }, 400);
  }

  return json({ ok: true });
});
