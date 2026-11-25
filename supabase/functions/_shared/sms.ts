// Two-way texting through one shared Bakerï number (Twilio). See migration
// 20261125000003_order_texts.sql. Secrets: TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (preferred) or
// TWILIO_FROM_NUMBER. Until they're set, texting reports "not set up".

const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const SERVICE = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? "";
const FROM = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

export const smsConfigured = () => !!(SID && TOKEN && (SERVICE || FROM));

/** E.164 for a US/Canada number as bakers and customers type it; null if it isn't one. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 10 && digits.length <= 15) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

export async function sendSms(to: string, body: string, statusCallback?: string): Promise<{ sid: string; status: string }> {
  const form = new URLSearchParams({ To: to, Body: body });
  if (SERVICE) form.set("MessagingServiceSid", SERVICE); else form.set("From", FROM);
  if (statusCallback) form.set("StatusCallback", statusCallback);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `Twilio ${r.status}`);
  return { sid: j.sid, status: j.status };
}

/** Twilio's request signature: base64(HMAC-SHA1(token, url + sorted key+value pairs)). */
export async function validTwilioSignature(url: string, params: URLSearchParams, signature: string | null): Promise<boolean> {
  if (!signature || !TOKEN) return false;
  const keys = [...new Set([...params.keys()])].sort();
  const data = url + keys.map((k) => k + (params.get(k) ?? "")).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"];
export const START_WORDS = ["START", "UNSTOP", "YES"];

/** "(717) 555-0123" for a +1 number, else the E.164 as is. */
export function prettyPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
