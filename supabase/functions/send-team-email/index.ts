import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendEmail } from "../_shared/resend.ts";

// send-team-email (Harvey 2026-11-02): Bakerï's own one-off emails — founder
// notes, announcements sent for review — through Resend from
// hello@bakeriapp.com. Service-role only: deployed WITH JWT verification, so
// Supabase checks the token's signature, and this function then requires the
// token's role to be service_role (Bakeri Admin / the team's tooling). Never
// callable by vendors, customers or the public.
//
// Body: { to: string[], subject: string, html: string, reply_to?: string, sender?: "harvey" | "diana" }
// Each recipient gets their own copy ({{name}} is left for the caller to fill).
// `sender` picks the From name (the CRM in Bakeri Admin sends as whoever is
// working the list); the address is always hello@bakeriapp.com.

const SENDERS: Record<string, string> = {
  harvey: "Harvey at Bakerï <hello@bakeriapp.com>",
  diana: "Diana at Bakerï <hello@bakeriapp.com>",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // The gateway already verified the signature; only the role is checked here.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let role = "";
  try { role = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? ""; } catch { /* not a JWT */ }
  if (role !== "service_role") return json({ error: "Forbidden" }, 403);

  let body: { to?: unknown; subject?: unknown; html?: unknown; reply_to?: unknown; sender?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const to = Array.isArray(body.to) ? body.to.map(String).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) : [];
  const subject = String(body.subject ?? "").trim();
  const html = String(body.html ?? "");
  if (!to.length || !subject || !html) return json({ error: "to, subject and html are required" }, 400);
  if (to.length > 20) return json({ error: "Up to 20 recipients per call" }, 400);
  const from = SENDERS[typeof body.sender === "string" ? body.sender : "harvey"];
  if (!from) return json({ error: "sender must be harvey or diana" }, 400);

  const results = [];
  for (const addr of to) {
    const r = await sendEmail({
      from,
      to: addr,
      reply_to: typeof body.reply_to === "string" ? body.reply_to : "hello@bakeriapp.com",
      subject,
      html,
    });
    results.push({ to: addr, ok: r.ok, error: r.error ?? null });
  }
  return json({ ok: results.every((r) => r.ok), results });
});
