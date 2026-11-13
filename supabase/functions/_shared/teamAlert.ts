// Alerts to the team inbox (hello@bakeriapp.com) when someone signs up or
// starts a plan (Harvey 2026-11-13). Built on the base email style.

import { bakeriEmailHtml, escapeHtml } from "./emailBase.ts";
import { sendEmail } from "./resend.ts";

export const TEAM_INBOX = "hello@bakeriapp.com";

/** rows: label → value (plain text; empty values are left out). */
export async function sendTeamAlert(opts: {
  eyebrow: string;
  subject: string;
  heading: string;
  rows: [string, string | null | undefined][];
  replyTo?: string | null;
}) {
  const lines = opts.rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<strong style="color:#14110e;">${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}`);
  const html = bakeriEmailHtml({
    eyebrow: opts.eyebrow,
    heading: opts.heading,
    preheader: opts.subject,
    paragraphs: [lines.join("<br>")],
    footnote: "Sent automatically to the team inbox. The account is in Bakeri Admin → Users.",
    signoff: "team",
  });
  const r = await sendEmail({
    from: "Bakerï <hello@bakeriapp.com>",
    to: TEAM_INBOX,
    subject: opts.subject,
    html,
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
  });
  if (!r.ok) console.error(`Team alert "${opts.subject}" failed:`, r.error);
  return r;
}
