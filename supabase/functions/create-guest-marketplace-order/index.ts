import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint for baker/checkout.html — records a
// guest's already-paid marketplace purchase (ready_now or preorder listing)
// as a normal pending order, exactly like an authenticated in-app buyer's
// order (create-marketplace-orders), minus the auth requirement. Mirrors
// that function's insert shape closely so the order behaves identically in
// the baker's existing Orders UI, notify trigger, and payout sweep.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\s]{7,20}$/;

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

// ── Tax — ported from Bakerly/Bakerly/Bakeri/Services/TaxCalculator.swift.
// Keep in sync with that file if the CRA rules or rate table ever change. ──

type TaxCategory = "sweetened_single_serving" | "plain_bread" | "whole_item";

function taxRateForProvince(province: string): number {
  switch (province.toUpperCase().trim()) {
    case "ON": return 0.13;
    case "NB": case "NL": case "PE": return 0.15;
    case "NS": return 0.14;
    case "QC": return 0.14975;
    default: return 0.05;
  }
}

function isSingleServing(taxCategory: TaxCategory, unitWeightGrams: number | null): boolean {
  if (taxCategory !== "sweetened_single_serving") return false;
  if (unitWeightGrams != null) return unitWeightGrams <= 230;
  return true; // unknown weight treated as single-serving — conservative / pro-remittance
}

function calculateTaxCents(
  items: { taxCategory: TaxCategory; unitWeightGrams: number | null; quantity: number; pricePerUnit: number }[],
  bakerIsGSTRegistered: boolean,
  province: string
): number {
  if (!bakerIsGSTRegistered) return 0;

  const rate = taxRateForProvince(province || "AB");

  const totalSingleServings = items
    .filter((i) => isSingleServing(i.taxCategory, i.unitWeightGrams))
    .reduce((sum, i) => sum + i.quantity, 0);

  let taxableSubtotal = 0;
  for (const item of items) {
    if (item.taxCategory === "plain_bread" || item.taxCategory === "whole_item") continue;
    // sweetened_single_serving: taxable only when total single-servings < 6
    if (isSingleServing(item.taxCategory, item.unitWeightGrams) && totalSingleServings < 6) {
      taxableSubtotal += item.pricePerUnit * item.quantity;
    }
  }

  return Math.round(taxableSubtotal * rate * 100);
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

  const payment_intent_id = String(body.payment_intent_id ?? "").trim();
  const baker_id = String(body.baker_id ?? "").trim();
  const menu_item_id = String(body.menu_item_id ?? "").trim();
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
  const customer_name = String(body.customer_name ?? "").trim();
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();
  const customer_phone = String(body.customer_phone ?? "").trim();

  if (!payment_intent_id || !baker_id || !menu_item_id) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!PHONE_RE.test(customer_phone)) return json({ error: "Please enter a valid phone number." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Re-verify the PaymentIntent actually succeeded — never trust the client.
  const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${payment_intent_id}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!stripeRes.ok) return json({ error: "Could not verify payment." }, 400);
  const intent = await stripeRes.json();
  if (intent.status !== "succeeded") {
    return json({ error: `Payment not confirmed. Status: ${intent.status}` }, 400);
  }

  // Re-fetch the listing server-side — never trust client-supplied price/name.
  const { data: menuItem, error: menuItemErr } = await db
    .from("menu_items")
    .select(
      "id, user_id, name, default_price, marketplace_price_from, listing_kind, " +
      "is_listed_in_marketplace, is_active, tax_category, unit_weight_grams, preorder_drop_date"
    )
    .eq("id", menu_item_id)
    .single();

  if (menuItemErr || !menuItem) return json({ error: "This listing is no longer available." }, 400);
  if (menuItem.user_id !== baker_id) return json({ error: "This listing is no longer available." }, 400);
  if (!menuItem.is_listed_in_marketplace) {
    return json({ error: "This listing is no longer available." }, 400);
  }
  if (menuItem.listing_kind === "custom") {
    return json({ error: "This listing requires a custom order request, not direct checkout." }, 400);
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, is_gst_registered, pickup_province")
    .eq("id", baker_id)
    .single();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";

  const priceFrom = (menuItem.marketplace_price_from ?? 0) > 0
    ? menuItem.marketplace_price_from
    : menuItem.default_price;

  const taxCents = calculateTaxCents(
    [{
      taxCategory: menuItem.tax_category as TaxCategory,
      unitWeightGrams: menuItem.unit_weight_grams,
      quantity,
      pricePerUnit: priceFrom,
    }],
    bakerProfile?.is_gst_registered === true,
    bakerProfile?.pickup_province ?? ""
  );
  const subtotalCents = Math.round(priceFrom * quantity * 100);
  const totalCents = subtotalCents + taxCents;

  const clientIp = getClientIp(req);
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const dueDate = menuItem.preorder_drop_date ?? new Date(Date.now() + 86400000).toISOString();

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
    is_paid: true,
    payment_note: `Subtotal: $${(subtotalCents / 100).toFixed(2)}, Tax: $${(taxCents / 100).toFixed(2)}, Total: $${(totalCents / 100).toFixed(2)}`,
    deposit_amount: 0,
    deposit_note: "",
    fulfillment_type: "Pickup",
    delivery_details: "",
    is_delivery: false,
    delivery_address: null,
    created_at: now,
    updated_at: now,
    color_name: menuItem.listing_kind === "ready_now" ? "red" : "blue",
    order_source: "marketplace",
    marketplace_status: "pending",
    buyer_profile_id: null,
    buyer_display_name: customer_name,
    scheduled_pickup_date: menuItem.preorder_drop_date ?? null,
    payment_intent_id,
    payment_status: "authorized",
    reference_photo_count: 0,
    lead_channel: "website",
    ip_address: clientIp,
  });

  if (orderErr) {
    console.error("orders insert failed:", orderErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  const { error: itemErr } = await db.from("order_items").insert({
    id: crypto.randomUUID(),
    user_id: baker_id,
    order_id: orderId,
    recipe_id: null,
    custom_name: menuItem.name,
    quantity,
    unit: "pieces",
    price_per_unit: priceFrom,
    notes: "",
    updated_at: now,
  });

  if (itemErr) {
    console.error("order_items insert failed:", itemErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  return json({
    order_id: orderId,
    items: [{ name: menuItem.name, quantity, price_per_unit: priceFrom }],
    subtotal_cents: subtotalCents,
    tax_cents: taxCents,
    total_cents: totalCents,
    baker_name: bakerDisplayName,
  });
});
