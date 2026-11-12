import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { applicationReceivedHtml, escapeHtml, HARVEY_FROM, partnerEmailHtml, sendPartnerEmail, TEAM_INBOX } from "../_shared/partnerEmail.ts";

// Public "Apply to be a Community Growth Partner" form
// (bakeriapp.com/community-growth-partners.html). Same guards as
// submit-vendor-application: reCAPTCHA Enterprise, MX check, a hidden
// honeypot field and a per-IP daily limit. Writes a pending
// growth_partner_applications row for Bakeri Admin → Growth Partners to
// approve or decline, emails the applicant a receipt and the team an alert.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECAPTCHA_PROJECT_ID = Deno.env.get("RECAPTCHA_PROJECT_ID") ?? "";
const RECAPTCHA_API_KEY = Deno.env.get("RECAPTCHA_API_KEY") ?? "";

const RECAPTCHA_SITE_KEY = "6LcIGEgtAAAAAAYXr8zyy_jJse4xc9LgjN43otQf";
const RECAPTCHA_ACTION = "submit_partner_application";
const RECAPTCHA_SCORE_THRESHOLD = 0.5;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
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

function clientIp(req: Request): string | null {
  const h = req.headers;
  return h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

async function hasMxRecord(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return true;
    const data = await res.json();
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return true;
  }
}

// Fails open on Google-side errors (like submit-vendor-application) — the
// honeypot, MX check and IP limit still apply.
async function verifyRecaptcha(token: string): Promise<boolean> {
  if (!RECAPTCHA_PROJECT_ID || !RECAPTCHA_API_KEY) return true;
  try {
    const res = await fetch(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${RECAPTCHA_PROJECT_ID}/assessments?key=${RECAPTCHA_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: { token, expectedAction: RECAPTCHA_ACTION, siteKey: RECAPTCHA_SITE_KEY } }),
      },
    );
    if (!res.ok) return true;
    const data = await res.json();
    if (!data.tokenProperties?.valid) return false;
    if (data.tokenProperties.action !== RECAPTCHA_ACTION) return false;
    return (data.riskAnalysis?.score ?? 0) >= RECAPTCHA_SCORE_THRESHOLD;
  } catch {
    return true;
  }
}

const clip = (v: unknown, n: number) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  // Honeypot: real people never see this field.
  if (String(body.company_url ?? "").trim()) return json({ ok: true });

  const name = clip(body.name, 120);
  const email = String(body.email ?? "").trim().toLowerCase();
  const audience = clip(body.audience, 2000);
  const plan = clip(body.plan, 2000);
  if (!name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!audience) return json({ error: "Tell us who you’d introduce Bakerï to." }, 400);
  if (body.agree !== true) return json({ error: "Please confirm you’ve read the partner guidelines." }, 400);

  if (!(await verifyRecaptcha(String(body.recaptcha_token ?? "")))) {
    return json({ error: "We couldn't verify you're human. Please refresh the page and try again." }, 400);
  }
  if (!(await hasMxRecord(email.split("@")[1]))) {
    return json({ error: "We couldn't find a mail server for that email domain. Please double-check your email address." }, 400);
  }

  const ip = clientIp(req);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (ip) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await db.from("growth_partner_applications")
      .select("id", { count: "exact", head: true }).eq("ip_address", ip).gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_PER_24H) {
      return json({ error: "Too many applications submitted recently. Please try again later." }, 429);
    }
  }

  // One open application per email — a second submit just updates it.
  const { data: open } = await db.from("growth_partner_applications")
    .select("id").ilike("email", email).eq("status", "pending").maybeSingle();

  const referral = String(body.referral_code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const row = {
    name, email,
    company: clip(body.company, 160),
    website: clip(body.website, 300),
    instagram: clip(body.instagram, 120),
    tiktok: clip(body.tiktok, 120),
    country: clip(body.country, 2)?.toUpperCase() ?? null,
    city: clip(body.city, 120),
    audience, plan,
    audience_size: clip(body.audience_size, 60),
    heard_from: clip(body.heard_from, 300),
    referral_code: /^[A-Z0-9]{4,16}$/.test(referral) ? referral : null,
    ip_address: ip,
  };

  const { error } = open
    ? await db.from("growth_partner_applications").update(row).eq("id", open.id)
    : await db.from("growth_partner_applications").insert(row);
  if (error) {
    console.error("growth_partner_applications write failed:", error.message);
    return json({ error: "Something went wrong saving your application. Please try again." }, 500);
  }

  await sendPartnerEmail(email, "Thanks for applying to Bakerï Community Growth Partners", applicationReceivedHtml(name),
    TEAM_INBOX, HARVEY_FROM).catch(() => {});

  const lines = [
    `<strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;${row.company ? ` · ${escapeHtml(row.company)}` : ""}`,
    row.website || row.instagram ? escapeHtml([row.website, row.instagram && `IG ${row.instagram}`].filter(Boolean).join(" · ")) : "",
    `<em>Audience:</em> ${escapeHtml(audience)}`,
    plan ? `<em>Plan:</em> ${escapeHtml(plan)}` : "",
    "Approve or decline in Bakeri Admin → Growth Partners.",
  ].filter(Boolean);
  await sendPartnerEmail(TEAM_INBOX, `New Growth Partner application — ${name}`, partnerEmailHtml({
    heading: "New partner application", paragraphs: lines,
  }), email).catch(() => {});

  return json({ ok: true });
});
