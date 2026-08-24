import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendBakerOrderEmail } from "../_shared/bakerOrderEmail.ts";
import { resolveBakerEmail } from "../_shared/bakerEmail.ts";
import { logNotification } from "../_shared/notificationLog.ts";

// Public, unauthenticated endpoint for baker/custom-order.html — lets a
// stranger with no Bakeri account submit a baker's intake form for a
// specific listing as a lead. Inserts land as a normal marketplace
// pending_quote order (buyer_profile_id left NULL) so the existing baker
// Orders inbox, notify trigger, and eventual invoice-payment flow all just
// work without any baker-side changes. RLS already blocks anon writes to
// orders/order_items (INSERT policies require buyer_profile_id =
// auth.uid()); this function's service role is the only writer for these
// guest rows.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECAPTCHA_PROJECT_ID = Deno.env.get("RECAPTCHA_PROJECT_ID")!;
const RECAPTCHA_API_KEY = Deno.env.get("RECAPTCHA_API_KEY")!;

// Same enterprise site key the rest of bakeriapp.com loads grecaptcha.enterprise
// with (see submit-vendor-application) — one site key covers the whole domain,
// the action string is what distinguishes this flow.
const RECAPTCHA_SITE_KEY = "6LcIGEgtAAAAAAYXr8zyy_jJse4xc9LgjN43otQf";
const RECAPTCHA_ACTION = "submit_custom_order_inquiry";
const RECAPTCHA_SCORE_THRESHOLD = 0.5;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\s]{7,20}$/;
const RATE_LIMIT_PER_24H = 5;
const MAX_PHOTOS_PER_FIELD = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// Mirrors the maxlength attributes in custom-order.html — enforced here too
// since a client-side attribute is trivially bypassed by anyone calling this
// endpoint directly. Caps how much arbitrary buyer-authored text can land in
// form_responses, which the baker's app renders as plain text today, but a
// hard length limit is cheap insurance against abuse (huge payloads, or a
// future feature that summarizes this text) regardless of what reads it.
const MAX_SHORT_TEXT_LENGTH = 300;
const MAX_LONG_TEXT_LENGTH = 2000;
const MAX_NAME_LENGTH = 200;

const ANSWER_FIELD_TYPES = new Set([
  "short_text", "long_text", "number", "single_choice", "multi_choice", "date", "photo", "product_selector",
]);
// Baker-configured cap when a field doesn't set its own per-option max_quantity.
const DEFAULT_MAX_PRODUCT_QUANTITY = 999;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getClientIp(req: Request): string | null {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

async function verifyRecaptcha(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${RECAPTCHA_PROJECT_ID}/assessments?key=${RECAPTCHA_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { token, expectedAction: RECAPTCHA_ACTION, siteKey: RECAPTCHA_SITE_KEY },
        }),
      },
    );
    if (!res.ok) {
      console.error("reCAPTCHA assessment request failed:", res.status, await res.text());
      return true; // fail open on Google API hiccups
    }
    const data = await res.json();
    if (!data.tokenProperties?.valid) {
      console.warn("reCAPTCHA token invalid:", data.tokenProperties?.invalidReason);
      return false;
    }
    if (data.tokenProperties.action !== RECAPTCHA_ACTION) return false;
    return (data.riskAnalysis?.score ?? 0) >= RECAPTCHA_SCORE_THRESHOLD;
  } catch (err) {
    console.error("reCAPTCHA assessment errored:", err);
    return true;
  }
}

interface IncomingAnswer {
  fieldID: string;
  label: string;
  fieldType: string;
  textValue?: string | null;
  choiceValues?: string[] | null;
  // Client sends raw photo data to be uploaded server-side, not paths —
  // a guest has no auth.uid() to upload under directly.
  photos?: { filename: string; contentType: string; base64: string }[];
  // Client only sends which options + quantities were picked — name/price are
  // re-derived server-side from the field's own stored product_options below,
  // never trusted from the client.
  productSelections?: { id: string; quantity: number }[] | null;
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
  maxQuantity?: number;
  max_quantity?: number;
}

function isBlank(a: IncomingAnswer): boolean {
  if (a.fieldType === "single_choice" || a.fieldType === "multi_choice") {
    return !a.choiceValues || a.choiceValues.length === 0;
  }
  if (a.fieldType === "photo") {
    return !a.photos || a.photos.length === 0;
  }
  if (a.fieldType === "product_selector") {
    return !a.productSelections || !a.productSelections.some((s) => s.quantity > 0);
  }
  return !a.textValue || a.textValue.trim() === "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const baker_id = String(body.baker_id ?? "").trim();
  const menu_item_id = String(body.menu_item_id ?? "").trim();
  const customer_name = String(body.customer_name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();
  const customer_phone = String(body.customer_phone ?? "").trim();
  const answers: IncomingAnswer[] = Array.isArray(body.answers) ? body.answers as IncomingAnswer[] : [];
  const recaptcha_token = String(body.recaptcha_token ?? "");

  if (!baker_id || !menu_item_id) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!PHONE_RE.test(customer_phone)) return json({ error: "Please enter a valid phone number." }, 400);

  if (!recaptcha_token || !(await verifyRecaptcha(recaptcha_token))) {
    return json({ error: "We couldn't verify you're human. Please refresh the page and try again." }, 400);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Re-verify the listing server-side — never trust baker_id/menu_item_id/
  // form shape from the client.
  const { data: menuItem, error: menuItemErr } = await db
    .from("menu_items")
    .select("id, user_id, name, default_price, marketplace_price_from, is_listed_in_marketplace, is_active, intake_form_id")
    .eq("id", menu_item_id)
    .single();

  if (menuItemErr || !menuItem) return json({ error: "This listing is no longer available." }, 400);
  if (menuItem.user_id !== baker_id) return json({ error: "This listing is no longer available." }, 400);
  if (!menuItem.is_listed_in_marketplace) {
    return json({ error: "This listing is no longer available." }, 400);
  }
  if (!menuItem.intake_form_id) {
    return json({ error: "This listing doesn't accept custom order requests." }, 400);
  }

  const { data: bakerProfile, error: bakerProfileErr } = await db
    .from("profiles")
    .select("business_name, user_name, email, stripe_connect_onboarding_complete")
    .eq("id", baker_id)
    .single();

  if (bakerProfileErr || !bakerProfile) return json({ error: "This listing is no longer available." }, 400);
  if (!bakerProfile.stripe_connect_onboarding_complete) {
    const bakerDisplayName = bakerProfile.business_name?.trim() || bakerProfile.user_name?.trim() || "This baker";
    return json({ error: `${bakerDisplayName} hasn't finished setting up payments yet. Check back soon!` }, 400);
  }

  const { data: fields, error: fieldsErr } = await db
    .from("intake_form_fields")
    .select("id, field_type, label, is_required, product_options")
    .eq("form_id", menuItem.intake_form_id);

  if (fieldsErr || !fields) return json({ error: "Something went wrong. Please try again." }, 400);

  const answersByField = new Map(answers.map((a) => [a.fieldID, a]));
  for (const field of fields) {
    if (!ANSWER_FIELD_TYPES.has(field.field_type)) continue; // heading
    if (!field.is_required) continue;
    const answer = answersByField.get(field.id);
    if (!answer || isBlank(answer)) {
      return json({ error: `Please fill out "${field.label}".` }, 400);
    }
  }

  const clientIp = getClientIp(req);

  // Upload any photo answers on the guest's behalf — the form-response-photos
  // bucket's INSERT policy requires auth.uid(), which a guest doesn't have.
  // Service role bypasses that entirely.
  const finalAnswers: Record<string, unknown>[] = [];
  for (const field of fields) {
    const answer = answersByField.get(field.id);
    if (field.field_type === "heading") continue;
    if (!answer) continue;

    if (field.field_type === "photo") {
      const photos = (answer.photos ?? []).slice(0, MAX_PHOTOS_PER_FIELD);
      const paths: string[] = [];
      for (const photo of photos) {
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0));
        } catch {
          continue;
        }
        if (bytes.byteLength > MAX_PHOTO_BYTES) continue;
        const path = `web-guest-${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`;
        const { error: uploadErr } = await db.storage
          .from("form-response-photos")
          .upload(path, bytes, { contentType: photo.contentType || "image/jpeg", upsert: true });
        if (!uploadErr) paths.push(path);
      }
      finalAnswers.push({
        fieldID: field.id, label: field.label, fieldType: field.field_type,
        textValue: null, choiceValues: null, photoPaths: paths,
      });
    } else if (field.field_type === "single_choice" || field.field_type === "multi_choice") {
      finalAnswers.push({
        fieldID: field.id, label: field.label, fieldType: field.field_type,
        textValue: null, choiceValues: answer.choiceValues ?? [], photoPaths: null,
      });
    } else if (field.field_type === "product_selector") {
      // Recompute name/unitPrice from the field's own stored product_options and
      // clamp quantity to its max_quantity — never trust the client's numbers,
      // even though this figure is only ever informational (the baker still
      // manually quotes the order after reviewing it).
      const catalog = new Map(
        ((field.product_options ?? []) as ProductOption[]).map((o) => [o.id, o]),
      );
      const selections = (answer.productSelections ?? [])
        .map((s) => {
          const option = catalog.get(s.id);
          if (!option) return null;
          const max = option.maxQuantity ?? option.max_quantity ?? 0;
          const cap = max > 0 ? max : DEFAULT_MAX_PRODUCT_QUANTITY;
          const quantity = Math.max(0, Math.min(Math.floor(Number(s.quantity) || 0), cap));
          if (quantity <= 0) return null;
          return { id: option.id, name: option.name, unitPrice: option.price, quantity };
        })
        .filter((s) => s !== null);
      finalAnswers.push({
        fieldID: field.id, label: field.label, fieldType: field.field_type,
        textValue: null, choiceValues: null, photoPaths: null, productSelections: selections,
      });
    } else {
      const maxLen = field.field_type === "long_text" ? MAX_LONG_TEXT_LENGTH : MAX_SHORT_TEXT_LENGTH;
      finalAnswers.push({
        fieldID: field.id, label: field.label, fieldType: field.field_type,
        textValue: (answer.textValue ?? "").slice(0, maxLen), choiceValues: null, photoPaths: null,
      });
    }
  }

  const bakerDisplayName = bakerProfile.business_name?.trim() || bakerProfile.user_name?.trim() || "Baker";

  const priceFrom = (menuItem.marketplace_price_from ?? 0) > 0
    ? menuItem.marketplace_price_from
    : menuItem.default_price;

  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const dueDate = new Date(Date.now() + 7 * 86400000).toISOString();

  const { error: orderErr } = await db.from("orders").insert({
    id: orderId,
    user_id: baker_id,
    order_name: menuItem.name,
    baker_display_name: bakerDisplayName,
    customer_name,
    customer_phone,
    customer_email,
    due_date: dueDate,
    status: "Confirmed",
    notes: "",
    is_paid: false,
    payment_note: "",
    deposit_amount: 0,
    deposit_note: "",
    fulfillment_type: "Pickup",
    delivery_details: "",
    is_delivery: false,
    delivery_address: null,
    created_at: now,
    updated_at: now,
    color_name: "blue",
    order_source: "marketplace",
    marketplace_status: "pending_quote",
    buyer_profile_id: null,
    buyer_display_name: customer_name,
    scheduled_pickup_date: null,
    payment_intent_id: null,
    reference_photo_count: 0,
    lead_channel: "website",
    ip_address: clientIp,
    // The order sheet's "Customer's Answers" card (notesCard in
    // MarketplaceOrderSheet.swift) reads order.formResponsesJSON, not
    // order_items' own copy — both columns exist, but that's the one the
    // baker's Review screen actually displays.
    form_responses: finalAnswers.length > 0 ? finalAnswers : null,
  });

  if (orderErr) {
    if (orderErr.code === "P0001") {
      // Raised by trg_web_inquiry_limits — already a clean, user-facing message.
      return json({ error: orderErr.message }, 429);
    }
    console.error("orders insert failed:", orderErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  const { error: itemErr } = await db.from("order_items").insert({
    id: crypto.randomUUID(),
    user_id: baker_id,
    order_id: orderId,
    recipe_id: null,
    custom_name: menuItem.name,
    quantity: 1,
    unit: "pieces",
    price_per_unit: priceFrom,
    notes: "",
    form_responses: finalAnswers.length > 0 ? finalAnswers : null,
    updated_at: now,
  });

  if (itemErr) {
    console.error("order_items insert failed:", itemErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  // Best-effort, never blocks the response. Reaching this point already
  // means the orders INSERT above passed trg_web_inquiry_limits (5 per IP
  // per rolling 24h) — a spam burst is capped there, not here, so this can
  // never fire more than that trigger already allows per IP per day.
  const bakerEmail = await resolveBakerEmail(db, baker_id, bakerProfile.email);
  if (bakerEmail) {
    const result = await sendBakerOrderEmail({
      db,
      bakerId: baker_id,
      bakerEmail,
      items: [{ custom_name: menuItem.name, quantity: 1, price_per_unit: 0, menu_item_id: menuItem.id }],
      customerName: customer_name,
      customerEmail: customer_email,
      customerPhone: customer_phone,
      kind: "quote_request",
    });
    await logNotification(db, orderId, "baker_quote_request_email", result.ok ? "sent" : "failed", result.error);
  }

  return json({ ok: true });
});
