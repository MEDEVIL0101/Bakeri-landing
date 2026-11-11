// Emails for the Community Growth Partner program (application received,
// approved / invite, declined, waitlisted, new-application alert to the team).
// Plain, single-column, black button — same look as the vendor invite.

import { sendEmail } from "./resend.ts";

export const PARTNER_FROM = "Bakerï <hello@bakeriapp.com>";
export const TEAM_INBOX = "hello@bakeriapp.com";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** paragraphs: already-escaped HTML strings. */
export function partnerEmailHtml(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footnote?: string }): string {
  const ps = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1d1b1a;">${p}</p>`)
    .join("");
  const btn = opts.button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:999px;">${escapeHtml(opts.button.label)}</a></p>`
    : "";
  const foot = opts.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#77706b;">${opts.footnote}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ef;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;padding:36px 32px;">
<tr><td>
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5F92E6;font-weight:700;">Community Growth Partners</p>
<h1 style="margin:0 0 20px;font-size:26px;line-height:1.2;color:#111111;">${escapeHtml(opts.heading)}</h1>
${ps}${btn}${foot}
<p style="margin:28px 0 0;font-size:15px;color:#1d1b1a;">— The Bakerï team</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#9a928c;">Bakerï · bakeriapp.com</p>
</td></tr></table></body></html>`;
}

export async function sendPartnerEmail(to: string, subject: string, html: string, replyTo?: string) {
  return await sendEmail({ from: PARTNER_FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) });
}
