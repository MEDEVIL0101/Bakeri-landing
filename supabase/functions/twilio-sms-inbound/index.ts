// Twilio calls this for every text to the shared Bakerï number (deployed
// --no-verify-jwt; the request is checked against Twilio's signature instead).
// STOP/START words update sms_opt_outs. Anything else is a customer reply: it
// goes to the order that number was last texted about (within 60 days) and the
// baker gets a push. Always answers with empty TwiML (no auto-reply).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizePhone, START_WORDS, STOP_WORDS, validTwilioSignature } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";
// The URL Twilio is configured with (the signature covers it exactly).
const PUBLIC_URL = Deno.env.get("TWILIO_INBOUND_URL") ?? `${SUPABASE_URL}/functions/v1/twilio-sms-inbound`;
const twiml = () => new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const params = new URLSearchParams(await req.text());
  if (!(await validTwilioSignature(PUBLIC_URL, params, req.headers.get("X-Twilio-Signature")))) {
    return new Response("forbidden", { status: 403 });
  }
  const from = normalizePhone(params.get("From"));
  const body = (params.get("Body") ?? "").trim();
  if (!from || !body) return twiml();
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const word = body.toUpperCase().replace(/[^A-Z]/g, "");

  if (STOP_WORDS.includes(word)) { await db.from("sms_opt_outs").upsert({ phone: from }); return twiml(); }
  if (START_WORDS.includes(word)) { await db.from("sms_opt_outs").delete().eq("phone", from); return twiml(); }

  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: last } = await db.from("order_texts").select("order_id, user_id")
    .eq("customer_phone", from).eq("direction", "out").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!last) { console.log("inbound text with no recent conversation"); return twiml(); }

  await db.from("order_texts").insert({
    order_id: last.order_id, user_id: last.user_id, direction: "in", body, customer_phone: from,
    twilio_sid: params.get("MessageSid"),
  });

  if (ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY) {
    const { data: order } = await db.from("orders").select("customer_name").eq("id", last.order_id).maybeSingle();
    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${ONESIGNAL_REST_API_KEY}` },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_aliases: { external_id: [String(last.user_id).toUpperCase()] },
        target_channel: "push",
        headings: { en: `Text from ${(order?.customer_name || "a customer").trim()}` },
        contents: { en: body.slice(0, 180) },
        data: { type: "order_text", order_id: last.order_id, audience: "baker" },
      }),
    }).catch((e) => console.error("push failed:", e));
  }
  return twiml();
});
