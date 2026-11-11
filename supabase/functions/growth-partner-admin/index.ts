import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml, partnerEmailHtml, sendPartnerEmail } from "../_shared/partnerEmail.ts";

// Bakeri Admin → Growth Partners actions. Service role only (the Admin app's
// key), same check as admin-platform-revenue.
//
//   approve        { application_id | name+email(+company), rate, months, code?, note? }
//                  creates (or reuses) the auth user, the growth_partners row
//                  and their referral code on the chosen terms, then emails a
//                  one-time sign-in link to /app/partner/welcome.
//   decline        { application_id, note?, send_email? }
//   waitlist       { application_id, note?, send_email? }
//   resend_invite  { user_id }
//
// Sign-in links are built from generateLink's hashed_token and verified in
// the web app with verifyOtp, so they work in any browser (no PKCE verifier).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WELCOME_URL = "https://bakeriapp.com/app/partner/welcome";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type Body = Record<string, unknown>;

/** A one-time link that signs this email in at the partner welcome page.
 *  New → invite (sets a password there). Existing account → magic link, or a
 *  recovery link (also sets a password) when `needsPassword`. */
async function signInLink(email: string, needsPassword = false): Promise<{ userId: string; url: string; isNew: boolean }> {
  let type: "invite" | "magiclink" | "recovery" = "invite";
  let res = await db.auth.admin.generateLink({ type: "invite", email });
  if (res.error) {
    type = needsPassword ? "recovery" : "magiclink";
    res = await db.auth.admin.generateLink({ type, email });
  }
  if (res.error || !res.data?.user || !res.data.properties?.hashed_token) {
    throw new Error(res.error?.message ?? "Couldn't create a sign-in link");
  }
  const url = new URL(WELCOME_URL);
  url.searchParams.set("token_hash", res.data.properties.hashed_token);
  url.searchParams.set("type", type);
  return { userId: res.data.user.id, url: url.toString(), isNew: type !== "magiclink" };
}

function codeStem(source: string): string {
  let stem = "";
  for (const w of source.split(/[\s\-_.&]+/)) {
    const word = w.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!word) continue;
    if (!stem) stem = word.slice(0, 12);
    else if (stem.length + word.length <= 12) stem += word;
    else break;
  }
  return stem.length >= 3 ? stem : "PARTNER";
}

/** First free code: the stem itself, then stem + 2 digits. */
async function freeCode(source: string): Promise<string> {
  const stem = codeStem(source);
  const candidates = [stem, ...Array.from({ length: 30 }, () => stem + String(10 + Math.floor(Math.random() * 90)))];
  for (const c of candidates) {
    const { count } = await db.from("referral_codes").select("code", { count: "exact", head: true }).ilike("code", c);
    if ((count ?? 0) === 0) return c;
  }
  return stem + String(100 + Math.floor(Math.random() * 900));
}

function rateLine(rate: number, months: number | null): string {
  const pct = `${Math.round(rate * 1000) / 10}%`;
  return months
    ? `${pct} of every plan payment from each vendor you bring, for their first ${months} months`
    : `${pct} of every plan payment from each vendor you bring, for as long as they stay on a paid plan`;
}

async function sendInvite(email: string, name: string, url: string, rate: number, months: number | null, code: string, isNew: boolean) {
  const first = escapeHtml(name.split(/\s+/)[0] || "there");
  return await sendPartnerEmail(email, "You’re a Bakerï Community Growth Partner", partnerEmailHtml({
    heading: `Welcome aboard, ${first}`,
    paragraphs: [
      "You’re approved as a Bakerï Community Growth Partner.",
      `Your code is <strong>${escapeHtml(code)}</strong>. You earn ${escapeHtml(rateLine(rate, months))}.`,
      isNew
        ? "Use the button below to set your password and open your partner dashboard: tracked links, sign-ups, earnings and your outreach list."
        : "Use the button below to open your partner dashboard: tracked links, sign-ups, earnings and your outreach list. It uses the Bakerï account you already have.",
    ],
    button: { label: isNew ? "Set up my dashboard" : "Open my dashboard", url },
    footnote: "This link works once and expires in 24 hours. If it has expired, sign in at bakeriapp.com/app/partner/login and choose “Forgot your password?”.",
  }));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let role = "";
  try { role = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? ""; } catch { /* not a JWT */ }
  if (role !== "service_role") return json({ error: "Forbidden" }, 403);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(body.action ?? "");

  try {
    if (action === "approve") {
      const rate = Number(body.rate ?? 0.2);
      const months = body.months == null || body.months === "" ? null : Math.round(Number(body.months));
      if (!(rate > 0 && rate <= 0.9)) return json({ error: "Rate must be between 1% and 90%." }, 400);
      if (months !== null && !(months >= 1 && months <= 120)) return json({ error: "Term must be 1–120 months, or blank for no end." }, 400);

      // From an application, or a direct invite (Admin creates the application row).
      let app: Record<string, any> | null = null;
      if (body.application_id) {
        const { data } = await db.from("growth_partner_applications").select("*").eq("id", body.application_id).maybeSingle();
        app = data;
        if (!app) return json({ error: "Application not found." }, 404);
      } else {
        const email = String(body.email ?? "").trim().toLowerCase();
        const name = String(body.name ?? "").trim();
        if (!name || !email.includes("@")) return json({ error: "Name and email are needed." }, 400);
        const { data, error } = await db.from("growth_partner_applications").insert({
          name, email, company: String(body.company ?? "").trim() || null,
          audience: "Invited directly by the Bakerï team", heard_from: "Direct invite",
        }).select("*").single();
        if (error) return json({ error: error.message }, 500);
        app = data;
      }

      const email = String(app!.email).toLowerCase();
      const link = await signInLink(email);

      const { error: gpErr } = await db.from("growth_partners").upsert({
        user_id: link.userId, name: app!.name, email, company: app!.company,
        country: (app!.country || "CA").toUpperCase(), status: "active",
        application_id: app!.id, admin_note: body.note ? String(body.note) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (gpErr) return json({ error: gpErr.message }, 500);

      // Keep a vendor's existing code unless Admin typed a new one.
      const { data: existing } = await db.from("referral_codes").select("code").eq("user_id", link.userId).maybeSingle();
      const wanted = String(body.code ?? "").trim() || (existing ? null : await freeCode(app!.company || app!.name));
      const { data: terms, error: tErr } = await db.rpc("admin_set_referrer_terms", {
        p_user_id: link.userId, p_rate: rate, p_months: months, p_code: wanted, p_apply_existing: false,
      });
      if (tErr) return json({ error: tErr.message }, 500);
      if (terms?.status !== "saved") return json({ error: terms?.message ?? `Couldn't set the code (${terms?.status})` }, 400);

      await db.from("growth_partner_applications").update({
        status: "approved", decided_at: new Date().toISOString(), partner_user_id: link.userId,
        admin_note: body.note ? String(body.note) : app!.admin_note,
      }).eq("id", app!.id);

      const sent = await sendInvite(email, app!.name, link.url, rate, months, terms.code, link.isNew);
      return json({ ok: true, user_id: link.userId, code: terms.code, email_sent: sent.ok, email_error: sent.error ?? null });
    }

    if (action === "decline" || action === "waitlist") {
      const { data: app } = await db.from("growth_partner_applications").select("*").eq("id", body.application_id).maybeSingle();
      if (!app) return json({ error: "Application not found." }, 404);
      await db.from("growth_partner_applications").update({
        status: action === "decline" ? "declined" : "waitlisted",
        decided_at: new Date().toISOString(),
        admin_note: body.note ? String(body.note) : app.admin_note,
      }).eq("id", app.id);

      let emailSent = false;
      if (body.send_email === true) {
        const first = escapeHtml(String(app.name).split(/\s+/)[0] || "there");
        const html = action === "decline"
          ? partnerEmailHtml({
            heading: `Thanks for applying, ${first}`,
            paragraphs: [
              "Thank you for your interest in becoming a Bakerï Community Growth Partner. We aren’t able to offer a partnership right now.",
              "If you run a food or creator business yourself, every Bakerï vendor can still earn through our Refer a Vendor program.",
            ],
            button: { label: "See the referral program", url: "https://bakeriapp.com/referral-program.html" },
          })
          : partnerEmailHtml({
            heading: `You’re on the list, ${first}`,
            paragraphs: [
              "Thanks for applying to be a Bakerï Community Growth Partner. We’re bringing partners on in small groups, and we’ve saved your spot for an upcoming one.",
              "We’ll email you as soon as there’s room — nothing you need to do in the meantime.",
            ],
          });
        const res = await sendPartnerEmail(app.email, action === "decline" ? "Your Growth Partner application" : "You’re on the Growth Partner waitlist", html);
        emailSent = res.ok;
      }
      return json({ ok: true, email_sent: emailSent });
    }

    if (action === "resend_invite") {
      const { data: gp } = await db.from("growth_partners").select("*").eq("user_id", body.user_id).maybeSingle();
      if (!gp) return json({ error: "Partner not found." }, 404);
      // Never signed in → the new link sets a password too.
      const { data: u } = await db.auth.admin.getUserById(gp.user_id);
      const link = await signInLink(gp.email, !u?.user?.last_sign_in_at);
      const { data: c } = await db.from("referral_codes").select("code, commission_rate, commission_months").eq("user_id", gp.user_id).maybeSingle();
      const sent = await sendInvite(gp.email, gp.name, link.url, Number(c?.commission_rate ?? 0.2), c?.commission_months ?? null, c?.code ?? "", link.isNew);
      return json({ ok: sent.ok, error: sent.error ?? null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("growth-partner-admin:", action, message);
    return json({ error: message }, 500);
  }
});
