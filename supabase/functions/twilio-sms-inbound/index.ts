// Twilio calls this for every text to the shared Bakerï number (deployed
// --no-verify-jwt; the request is checked against Twilio's signature instead).
// Texting is send-only: STOP/START words update sms_opt_outs (required), and
// anything else gets an automatic reply pointing back to the baker's own
// contact details in her text. Nothing else is stored.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizePhone, START_WORDS, STOP_WORDS, validTwilioSignature } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The URL Twilio is configured with (the signature covers it exactly).
const PUBLIC_URL = Deno.env.get("TWILIO_INBOUND_URL") ?? `${SUPABASE_URL}/functions/v1/twilio-sms-inbound`;
const AUTO_REPLY = "This number can\u2019t receive messages. Please contact your baker using the details in their text. Reply STOP to opt out.";
const twiml = (msg?: string) => new Response(
  `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg}</Message>` : ""}</Response>`,
  { headers: { "Content-Type": "text/xml" } },
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const params = new URLSearchParams(await req.text());
  if (!(await validTwilioSignature(PUBLIC_URL, params, req.headers.get("X-Twilio-Signature")))) {
    return new Response("forbidden", { status: 403 });
  }
  const from = normalizePhone(params.get("From"));
  const word = (params.get("Body") ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!from) return twiml();
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  // Twilio's own opt-out handling also answers these; we just record them.
  if (STOP_WORDS.includes(word)) { await db.from("sms_opt_outs").upsert({ phone: from }); return twiml(); }
  if (START_WORDS.includes(word)) { await db.from("sms_opt_outs").delete().eq("phone", from); return twiml(); }
  return twiml(AUTO_REPLY);
});
