// Every customer-facing transactional email in this repo goes out through one
// platform mailbox — hello@bakeriapp.com — and that stays, because SPF/DKIM/
// DMARC are all aligned to bakeriapp.com and moving the From address would
// wreck deliverability. What changes here is only the *display name* and the
// Reply-To:
//
//   From:      "Sugar Bloom via Bakerï <hello@bakeriapp.com>"
//   Reply-To:  the baker's own account email
//
// Bakerï runs no in-app messaging and is not the merchant of record for a
// storefront sale, so when a customer replies to a receipt / delivery /
// refund email with a problem, that reply has to land with the baker who
// actually sold and fulfils the order — not hello@. Before this, every reply
// came to Bakerï support and had to be relayed by hand.
//
// The baker address is resolved via resolveBakerEmail() (their Supabase Auth
// user email) — profiles.email is intentionally never populated, see
// bakerEmail.ts. If it can't be resolved, Reply-To is simply omitted and
// replies fall back to hello@ as before.

import { resolveBakerEmail } from "./bakerEmail.ts";

const PLATFORM_ADDRESS = "hello@bakeriapp.com";
const PLATFORM_NAME = "Bakerï";

// RFC 5322 display names can't carry CR/LF (header-injection vector) and a
// bare double-quote or backslash breaks the quoted-string form Resend builds.
// Collapse whitespace, drop those two chars, clamp length. Empty result →
// caller falls back to the plain platform identity.
export function sanitizeDisplayName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/[\r\n]+/g, " ")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * From header for a customer-facing email about one baker's order/quote/
 * invoice. e.g. `Sugar Bloom via Bakerï <hello@bakeriapp.com>`. Falls back to
 * `Bakerï <hello@bakeriapp.com>` when the baker name is unknown.
 */
export function customerFromLine(bakerName: string | null | undefined): string {
  const name = sanitizeDisplayName(bakerName);
  const display = name ? `${name} via ${PLATFORM_NAME}` : PLATFORM_NAME;
  // Always quote the display name — a baker business name can contain a comma
  // or other RFC 5322 "specials" that would otherwise split the address.
  // sanitizeDisplayName has already stripped `"` and `\`, so this is safe.
  return `"${display}" <${PLATFORM_ADDRESS}>`;
}

/**
 * From + Reply-To for a customer-facing email. Reply-To is the baker's account
 * email so a customer hitting Reply reaches the baker directly. When that
 * address can't be resolved, `reply_to` is left undefined — JSON.stringify
 * drops it and replies fall back to the platform mailbox.
 *
 * Pass `profileEmailFallback` only if the caller already has a profiles row in
 * hand; it's a last resort inside resolveBakerEmail and usually blank.
 */
export async function customerEmailIdentity(
  // deno-lint-ignore no-explicit-any
  db: any,
  bakerId: string | null | undefined,
  bakerName: string | null | undefined,
  profileEmailFallback?: string | null,
): Promise<{ from: string; reply_to?: string }> {
  const from = customerFromLine(bakerName);
  if (!bakerId) return { from };
  const bakerEmail = await resolveBakerEmail(db, bakerId, profileEmailFallback);
  return bakerEmail ? { from, reply_to: bakerEmail } : { from };
}
