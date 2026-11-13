import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendTeamAlert } from "../_shared/teamAlert.ts";

// notify-team-signup (Harvey 2026-11-13): emails hello@bakeriapp.com when a
// new account is created. Called by the trg_notify_team_signup trigger on
// auth.users (pg_net, 20261113000001_notify_team_signup.sql) with
// x-webhook-secret; deploy with --no-verify-jwt. Body: { user_id }.
// Trials and paid plans are announced by stripe-billing-webhook instead.

const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const SOURCES: Record<string, string> = { web: "Website sign-up", partner_invite: "Growth Partner invite" };
const PLANS: Record<string, string> = { starter: "Starter", pro: "Pro" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  let userId = "";
  try { userId = (await req.json()).user_id ?? ""; } catch { /* bad body */ }
  if (!userId) return new Response("user_id required", { status: 400 });

  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user) return new Response("No such user", { status: 404 });
  const user = data.user;
  const meta = (user.user_metadata ?? {}) as Record<string, string>;
  const { data: reg } = await db.from("registration_events").select("country_code").eq("user_id", userId).maybeSingle();

  const name = meta.full_name || meta.name || "";
  const planIntent = meta.plan_intent
    ? `${PLANS[meta.plan_intent] ?? meta.plan_intent}${meta.plan_cycle ? ` (${meta.plan_cycle === "year" ? "yearly" : "monthly"})` : ""}`
    : null;

  const r = await sendTeamAlert({
    eyebrow: "New sign-up",
    subject: `New Bakerï sign-up: ${user.email ?? userId}`,
    heading: "Someone just signed up",
    rows: [
      ["Email", user.email],
      ["Name", name],
      ["Business", meta.bakery_name],
      ["Referral code", meta.referral_code],
      ["How", SOURCES[meta.signup_source] ?? meta.signup_source ?? "Unknown"],
      ["Plan they picked", planIntent],
      ["Country", reg?.country_code],
      ["Signed up", new Date(user.created_at).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }) + " ET"],
      ["Email confirmed", user.email_confirmed_at ? "Yes" : "Not yet"],
    ],
    replyTo: user.email,
  });
  return new Response(r.ok ? "ok" : "send failed", { status: r.ok ? 200 : 500 });
});
