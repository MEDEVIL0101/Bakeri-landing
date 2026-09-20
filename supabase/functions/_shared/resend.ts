// Shared Resend-sending helper. Confirmed via research before this file
// existed: 20+ edge functions in this repo each hand-roll their own single
// -recipient `fetch("https://api.resend.com/emails", ...)` call — this is
// the first shared helper, introduced for send-baker-campaign rather than
// adding a 21st bespoke call site. Existing call sites are left as-is
// (out of scope for this change); a future cleanup could migrate them here.
//
// Sends individually, not via Resend's batch endpoint — correctness over
// throughput for v1. A baker's list is expected to be small; revisit if
// real usage shows this needs to change (see the plan's own note on this).

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

export interface ResendEmail {
  from: string;
  to: string;
  reply_to?: string;
  subject: string;
  html: string;
}

export async function sendEmail(email: ResendEmail): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(email),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: errText.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
}
