// Emails for the Community Growth Partner program (application received,
// approved / invite, declined, waitlisted, new-application alert to the team).
// Built on the base Bakerï email style (emailBase.ts).

import { bakeriEmailHtml, escapeHtml } from "./emailBase.ts";
import { sendEmail } from "./resend.ts";

export { escapeHtml };

export const PARTNER_FROM = "Bakerï <hello@bakeriapp.com>";
export const HARVEY_FROM = "Harvey at Bakerï <hello@bakeriapp.com>";
export const TEAM_INBOX = "hello@bakeriapp.com";

export function partnerEmailHtml(opts: Omit<Parameters<typeof bakeriEmailHtml>[0], "eyebrow">): string {
  return bakeriEmailHtml({ eyebrow: "Community Growth Partners", ...opts });
}

/** The thank-you every applicant gets the moment they apply. */
export function applicationReceivedHtml(name: string): string {
  const first = escapeHtml(name.trim().split(/\s+/)[0] || "there");
  return partnerEmailHtml({
    preheader: "Thanks for applying to the Bakerï Community Growth Partner program.",
    greeting: `Hi ${first},`,
    paragraphs: [
      "Thank you for applying to become a Bakerï Community Growth Partner. It means a lot that you want to help bring Bakerï to more food makers and creators.",
      "We’re opening the program to a small group of partners first, and we’re reviewing every application personally. We’ll be in touch by email soon with next steps.",
      "In the meantime, if you have any questions or there’s anything you’d like us to know, just reply to this email. It comes straight to me, and I read every one.",
    ],
    signoff: "harvey",
  });
}

export async function sendPartnerEmail(to: string, subject: string, html: string, replyTo?: string, from = PARTNER_FROM) {
  return await sendEmail({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) });
}
