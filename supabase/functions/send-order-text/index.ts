// The baker texts the customer on an order, from the shared Bakerï number:
// "<Shop>: <message>", ending with how to reach the baker directly (her number,
// else her storefront link) — the number is send-only. The first text to a
// number adds "Reply STOP to opt out".
// POST { order_id, message } with the baker's JWT. Stored in order_texts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizePhone, prettyPhone, sendSms, smsConfigured } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};
const fail = (error: string, status = 400) => new Response(JSON.stringify({ error }), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return fail("unauthorized", 401);
  const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return fail("unauthorized", 401);
  if (!smsConfigured()) return fail("not_set_up");

  try {
    const { order_id, message } = await req.json();
    const text = String(message ?? "").trim();
    if (!order_id || !text) return fail("empty_message");
    if (text.length > 600) return fail("too_long");
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: order } = await db.from("orders").select("id, user_id, customer_phone").eq("id", order_id).maybeSingle();
    if (!order || order.user_id !== user.id) return fail("not_found", 404);
    const { data: shop } = await db.from("profiles").select("business_name, user_name, sms_enabled, sms_reply_phone, profile_slug").eq("id", user.id).single();
    if (!shop?.sms_enabled) return fail("texting_off");
    const to = normalizePhone(order.customer_phone);
    if (!to) return fail("no_phone");
    const { data: stopped } = await db.from("sms_opt_outs").select("phone").eq("phone", to).maybeSingle();
    if (stopped) return fail("opted_out");

    const name = (shop.business_name || shop.user_name || "Your baker").trim();
    const { count } = await db.from("order_texts").select("id", { count: "exact", head: true })
      .eq("customer_phone", to).eq("direction", "out");
    const first = String(shop.user_name || "").trim().split(/\s+/)[0] || name;
    const reply = normalizePhone(shop.sms_reply_phone);
    const contact = reply
      ? `Questions? Text ${first} at ${prettyPhone(reply)}`
      : shop.profile_slug ? `Questions? Visit bakeriapp.com/${shop.profile_slug}` : "";
    const body = `${name}: ${text}` + (contact ? `\n\n${contact}` : "") + (count ? "" : "\nReply STOP to opt out.");
    const sent = await sendSms(to, body);
    const { data: row, error } = await db.from("order_texts").insert({
      order_id, user_id: user.id, direction: "out", body: text, customer_phone: to, twilio_sid: sent.sid, status: sent.status,
    }).select("id, direction, body, created_at, status").single();
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, text: row }), { headers: cors });
  } catch (e) {
    console.error("send-order-text:", e instanceof Error ? e.message : e);
    return fail("send_failed", 500);
  }
});
