import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";

// Public, unauthenticated endpoint for baker/checkout.html — records a
// guest's already-paid marketplace purchase (one or more ready_now/preorder
// line items from a single baker's storefront cart) as a normal pending
// order, exactly like an authenticated in-app buyer's order
// (create-marketplace-orders), minus the auth requirement. Mirrors that
// function's insert shape closely so the order behaves identically in the
// baker's existing Orders UI, notify trigger, and payout sweep.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

// The PaymentIntent this finalizes already charged subtotal + platform fee +
// tax (create-payment-intent), so the fee is recorded here (never trusting a
// client-supplied figure) — read back verbatim by release-baker-payouts for
// platform_custody orders, or already reflected in the direct charge's
// application_fee_amount for direct orders.

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
  items: { taxCategory: TaxCategory; unitWeightGrams: number | null; quantity: number; pricePerUnit: number; listingKind?: string }[],
  bakerIsGSTRegistered: boolean,
  province: string
): number {
  if (!bakerIsGSTRegistered) return 0;

  const rate = taxRateForProvince(province || "AB");

  // Digital goods (know-how/PDFs/courses) never have a physical
  // single-serving/weight concept — always $0 tax, excluded from the
  // single-serving count too.
  const physicalItems = items.filter((i) => i.listingKind !== "digital");

  const totalSingleServings = physicalItems
    .filter((i) => isSingleServing(i.taxCategory, i.unitWeightGrams))
    .reduce((sum, i) => sum + i.quantity, 0);

  let taxableSubtotal = 0;
  for (const item of physicalItems) {
    if (item.taxCategory === "plain_bread" || item.taxCategory === "whole_item") continue;
    // sweetened_single_serving: taxable only when total single-servings < 6
    if (isSingleServing(item.taxCategory, item.unitWeightGrams) && totalSingleServings < 6) {
      taxableSubtotal += item.pricePerUnit * item.quantity;
    }
  }

  return Math.round(taxableSubtotal * rate * 100);
}

type VariantSelection = { variant_id: string; quantity: number };
type CartLine = {
  menu_item_id: string;
  quantity: number;
  tier_id?: string;
  variant_selections?: VariantSelection[];
  chosen_preorder_date?: string;
};

// ── Pre-order scheduling — ported from Bakerly/Bakerly/Bakeri/Models/MenuItem.swift
// (weekdayComputedReadyDate) and baker/index.html (computeWeekdayReadyDate).
// Never trust a client-supplied due date beyond "which fixed_dates candidate
// they picked" — weekday/lead_time due dates are always computed here. ──

function computeWeekdayReadyDate(weekday: number, cutoffISO: string): string | null {
  const cutoff = new Date(cutoffISO);
  if (isNaN(cutoff.getTime())) return null;
  let date = new Date(cutoff.getTime() + 86400000);
  for (let i = 0; i < 7; i++) {
    // JS Date#getDay(): 0=Sunday...6=Saturday; Swift Calendar .weekday: 1=Sunday...7=Saturday.
    if (date.getDay() + 1 === weekday) return date.toISOString();
    date = new Date(date.getTime() + 86400000);
  }
  return null;
}

function resolveDueDate(item: Record<string, unknown>, chosenPreorderDate?: string): string {
  const nextDay = new Date(Date.now() + 86400000).toISOString();
  if (item.listing_kind !== "preorder") return nextDay;

  const mode = (item.preorder_schedule_mode as string) || "fixed_dates";
  if (mode === "weekday") {
    const weekday = item.preorder_weekday as number | null;
    const cutoff = item.preorder_order_cutoff_date as string | null;
    if (weekday == null || !cutoff) return nextDay;
    return computeWeekdayReadyDate(weekday, cutoff) ?? nextDay;
  }
  if (mode === "lead_time") {
    const days = (item.lead_days as number | null) ?? 2;
    return new Date(Date.now() + days * 86400000).toISOString();
  }
  // fixed_dates
  const dates = Array.isArray(item.preorder_dates) ? (item.preorder_dates as string[]) : [];
  if (dates.length > 1 && chosenPreorderDate && dates.includes(chosenPreorderDate)) return chosenPreorderDate;
  if (dates.length >= 1) return dates[0];
  return (item.preorder_drop_date as string | null) ?? nextDay;
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

  // Accept either the new multi-item `items` array or the old single-item
  // `menu_item_id`/`quantity` pair, so any lingering single-item caller
  // (or a stale cached checkout.html page) still works unmodified.
  let cartLines: CartLine[];
  if (Array.isArray(body.items)) {
    cartLines = (body.items as Record<string, unknown>[])
      .map((raw) => ({
        menu_item_id: String(raw.menu_item_id ?? "").trim(),
        quantity: Math.max(1, Math.floor(Number(raw.quantity) || 1)),
        tier_id: raw.tier_id != null ? String(raw.tier_id).trim() : undefined,
        variant_selections: Array.isArray(raw.variant_selections)
          ? (raw.variant_selections as Record<string, unknown>[]).map((v) => ({
              variant_id: String(v.variant_id ?? "").trim(),
              quantity: Math.max(0, Math.floor(Number(v.quantity) || 0)),
            }))
          : undefined,
        chosen_preorder_date: raw.chosenPreorderDate != null && String(raw.chosenPreorderDate).trim().length > 0
          ? String(raw.chosenPreorderDate).trim()
          : undefined,
      }))
      .filter((line) => line.menu_item_id.length > 0);
  } else {
    const menu_item_id = String(body.menu_item_id ?? "").trim();
    const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
    cartLines = menu_item_id ? [{ menu_item_id, quantity }] : [];
  }

  const customer_name = String(body.customer_name ?? "").trim();
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();
  const customer_phone = String(body.customer_phone ?? "").trim();

  if (!payment_intent_id || !baker_id || cartLines.length === 0) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!PHONE_RE.test(customer_phone)) return json({ error: "Please enter a valid phone number." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // This function only ever handles a single baker's cart (enforced below),
  // so the PaymentIntent create-payment-intent made for it was always a
  // direct charge on that baker's own connected account — verification must
  // target the same account or the retrieve 404s.
  const { data: connectRow } = await db
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", baker_id)
    .single();
  const connectedAccountId = connectRow?.stripe_connect_account_id ?? null;

  // Re-verify the PaymentIntent actually authorized (or, for deposits, fully
  // captured) — never trust the client. "requires_capture" is the expected
  // state for a regular (non-deposit) order now that create-payment-intent
  // holds funds instead of capturing immediately; "succeeded" covers deposits.
  let intent;
  try {
    intent = connectedAccountId
      ? await stripe.paymentIntents.retrieve(payment_intent_id, { stripeAccount: connectedAccountId })
      : await stripe.paymentIntents.retrieve(payment_intent_id);
  } catch {
    return json({ error: "Could not verify payment." }, 400);
  }
  if (intent.status !== "succeeded" && intent.status !== "requires_capture") {
    return json({ error: `Payment not confirmed. Status: ${intent.status}` }, 400);
  }

  // Re-fetch every listing server-side — never trust client-supplied price/name.
  const menuItemIds = cartLines.map((l) => l.menu_item_id);
  const { data: menuItems, error: menuItemErr } = await db
    .from("menu_items")
    .select(
      "id, user_id, name, default_price, marketplace_price_from, listing_kind, " +
      "is_listed_in_marketplace, is_active, tax_category, unit_weight_grams, preorder_drop_date, is_assorted_box, " +
      "preorder_schedule_mode, preorder_dates, preorder_weekday, preorder_order_cutoff_date, lead_days"
    )
    .in("id", menuItemIds);

  if (menuItemErr || !menuItems || menuItems.length !== menuItemIds.length) {
    return json({ error: "One or more items in your order are no longer available." }, 400);
  }

  const menuItemsById = new Map(menuItems.map((m) => [m.id, m]));
  const boxItemIds = menuItems.filter((m) => m.is_assorted_box).map((m) => m.id);

  // Live tier/variant catalog for any Assorted Box lines — never trust the
  // client's price or breakdown, only which ids it picked.
  let tiersByItemId = new Map<string, { id: string; label: string; unit_count: number; price: number }[]>();
  let variantsByItemId = new Map<string, { id: string; name: string }[]>();
  if (boxItemIds.length > 0) {
    const { data: tierRows } = await db
      .from("menu_item_size_tiers")
      .select("id, menu_item_id, label, unit_count, price")
      .in("menu_item_id", boxItemIds)
      .is("deleted_at", null);
    for (const t of tierRows ?? []) {
      const list = tiersByItemId.get(t.menu_item_id) ?? [];
      list.push({ id: t.id, label: t.label, unit_count: t.unit_count, price: t.price });
      tiersByItemId.set(t.menu_item_id, list);
    }

    const { data: variantRows } = await db
      .from("menu_item_variants")
      .select("id, menu_item_id, name")
      .in("menu_item_id", boxItemIds)
      .is("deleted_at", null);
    for (const v of variantRows ?? []) {
      const list = variantsByItemId.get(v.menu_item_id) ?? [];
      list.push({ id: v.id, name: v.name });
      variantsByItemId.set(v.menu_item_id, list);
    }
  }

  for (const line of cartLines) {
    const item = menuItemsById.get(line.menu_item_id);
    if (!item) return json({ error: "One or more items in your order are no longer available." }, 400);
    if (item.user_id !== baker_id) return json({ error: "This cart contains items from more than one baker." }, 400);
    if (!item.is_listed_in_marketplace) {
      return json({ error: `"${item.name}" is no longer available.` }, 400);
    }
    if (item.listing_kind === "custom") {
      return json({ error: `"${item.name}" requires a custom order request, not direct checkout.` }, 400);
    }
    if (item.listing_kind === "digital") {
      return json({ error: `"${item.name}" is a digital download — buy it directly from its own page, not the cart.` }, 400);
    }
    if (item.is_assorted_box) {
      const tier = (tiersByItemId.get(item.id) ?? []).find((t) => t.id === line.tier_id);
      if (!tier) return json({ error: `Please choose a size for "${item.name}".` }, 400);
      const validVariantIds = new Set((variantsByItemId.get(item.id) ?? []).map((v) => v.id));
      const selections = line.variant_selections ?? [];
      if (selections.length === 0 || selections.some((s) => !validVariantIds.has(s.variant_id))) {
        return json({ error: `Please choose your flavors for "${item.name}".` }, 400);
      }
      const total = selections.reduce((sum, s) => sum + s.quantity, 0);
      if (total !== tier.unit_count) {
        return json({ error: `"${item.name}" needs exactly ${tier.unit_count} pieces chosen — got ${total}.` }, 400);
      }
    }
    if (item.listing_kind === "preorder") {
      const mode = item.preorder_schedule_mode || "fixed_dates";
      const now = Date.now();
      if (mode === "weekday") {
        if (!item.preorder_order_cutoff_date || now > new Date(item.preorder_order_cutoff_date).getTime()) {
          return json({ error: `Ordering has closed for "${item.name}".` }, 400);
        }
      } else if (mode === "fixed_dates") {
        const dates: string[] = Array.isArray(item.preorder_dates) ? item.preorder_dates : [];
        if (dates.length > 1) {
          if (!line.chosen_preorder_date || !dates.includes(line.chosen_preorder_date)) {
            return json({ error: `Please choose a pickup date for "${item.name}".` }, 400);
          }
          if (new Date(line.chosen_preorder_date).getTime() <= now) {
            return json({ error: `That pickup date for "${item.name}" has passed — please refresh and pick another.` }, 400);
          }
        } else {
          const onlyDate = dates[0] ?? item.preorder_drop_date;
          if (onlyDate && new Date(onlyDate).getTime() <= now) {
            return json({ error: `"${item.name}" is no longer available for pre-order.` }, 400);
          }
        }
      }
      // lead_time: always open, ready date computed server-side from lead_days.
    }
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, is_gst_registered, pickup_province")
    .eq("id", baker_id)
    .single();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";

  const lines = cartLines.map((line) => {
    const item = menuItemsById.get(line.menu_item_id)!;
    if (item.is_assorted_box) {
      const tier = tiersByItemId.get(item.id)!.find((t) => t.id === line.tier_id)!;
      const variantsById = new Map((variantsByItemId.get(item.id) ?? []).map((v) => [v.id, v]));
      const variantBreakdown = (line.variant_selections ?? [])
        .filter((s) => s.quantity > 0)
        .map((s) => ({ name: variantsById.get(s.variant_id)?.name ?? "", quantity: s.quantity }));
      return {
        item, quantity: line.quantity, pricePerUnit: tier.price,
        tierLabel: tier.label, variantBreakdown, preorderDate: null as string | null,
      };
    }
    const priceFrom = (item.marketplace_price_from ?? 0) > 0
      ? item.marketplace_price_from
      : item.default_price;
    // Per-line resolved date — an order can hold several preorder lines for
    // the same listing on different dates (see resolveDueDate/baker/index.html),
    // so this rides on each order_item rather than only the order's own
    // due_date/scheduled_pickup_date (which stays the earliest across lines).
    const preorderDate = item.listing_kind === "preorder" ? resolveDueDate(item, line.chosen_preorder_date) : null;
    return {
      item, quantity: line.quantity, pricePerUnit: priceFrom,
      tierLabel: null as string | null, variantBreakdown: null as { name: string; quantity: number }[] | null,
      preorderDate,
    };
  });

  const taxCents = calculateTaxCents(
    lines.map((l) => ({
      taxCategory: l.item.tax_category as TaxCategory,
      unitWeightGrams: l.item.unit_weight_grams,
      quantity: l.quantity,
      pricePerUnit: l.pricePerUnit,
    })),
    bakerProfile?.is_gst_registered === true,
    bakerProfile?.pickup_province ?? ""
  );
  const subtotalCents = lines.reduce((sum, l) => sum + Math.round(l.pricePerUnit * l.quantity * 100), 0);
  // Fee is on the pre-tax item subtotal, matching what create-payment-intent
  // already added to this order's charge — customer pays it, baker doesn't.
  const platformFeeCents = Math.round(subtotalCents * PLATFORM_FEE_RATE);
  const totalCents = subtotalCents + platformFeeCents + taxCents;

  // Order name: the single item's name, or "First item + N more" for a cart —
  // matches how the app already summarizes multi-line manual orders.
  const orderName = lines.length === 1
    ? lines[0].item.name
    : `${lines[0].item.name} + ${lines.length - 1} more`;

  // Earliest due date across the cart's lines (mode-aware resolution per
  // line — see resolveDueDate) — a mixed ready-now/preorder cart is due on
  // the soonest commitment the baker actually made.
  const dueDates = cartLines.map((line) =>
    resolveDueDate(menuItemsById.get(line.menu_item_id)!, line.chosen_preorder_date)
  );
  const dueDate = dueDates.sort()[0];
  const hasPreorderLine = lines.some((l) => l.item.listing_kind === "preorder");

  const clientIp = getClientIp(req);
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: orderErr } = await db.from("orders").insert({
    id: orderId,
    user_id: baker_id,
    order_name: orderName,
    baker_display_name: bakerDisplayName,
    customer_name,
    customer_phone,
    customer_email,
    due_date: dueDate,
    status: "Confirmed",
    notes: "",
    is_paid: true,
    payment_note: `Subtotal: $${(subtotalCents / 100).toFixed(2)}, Bakeri fee: $${(platformFeeCents / 100).toFixed(2)}, Tax: $${(taxCents / 100).toFixed(2)}, Total: $${(totalCents / 100).toFixed(2)}`,
    platform_fee_cents: platformFeeCents,
    deposit_amount: 0,
    deposit_note: "",
    fulfillment_type: "Pickup",
    delivery_details: "",
    is_delivery: false,
    delivery_address: null,
    created_at: now,
    updated_at: now,
    color_name: hasPreorderLine ? "blue" : "red",
    order_source: "marketplace",
    marketplace_status: "pending",
    buyer_profile_id: null,
    buyer_display_name: customer_name,
    scheduled_pickup_date: dueDate,
    payment_intent_id,
    payment_status: "authorized",
    payment_model: connectedAccountId ? "direct" : "platform_custody",
    reference_photo_count: 0,
    lead_channel: "website",
    ip_address: clientIp,
  });

  if (orderErr) {
    console.error("orders insert failed:", orderErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  const { error: itemErr } = await db.from("order_items").insert(
    lines.map((l) => ({
      id: crypto.randomUUID(),
      user_id: baker_id,
      order_id: orderId,
      recipe_id: null,
      custom_name: l.tierLabel ? `${l.item.name} — ${l.tierLabel}` : l.item.name,
      quantity: l.quantity,
      unit: "pieces",
      price_per_unit: l.pricePerUnit,
      notes: "",
      updated_at: now,
      tier_label: l.tierLabel,
      variant_breakdown: l.variantBreakdown,
      preorder_date: l.preorderDate,
    }))
  );

  if (itemErr) {
    console.error("order_items insert failed:", itemErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  return json({
    order_id: orderId,
    items: lines.map((l) => ({
      name: l.tierLabel ? `${l.item.name} — ${l.tierLabel}` : l.item.name,
      quantity: l.quantity,
      price_per_unit: l.pricePerUnit,
      tier_label: l.tierLabel,
      variant_breakdown: l.variantBreakdown,
      preorder_date: l.preorderDate,
    })),
    subtotal_cents: subtotalCents,
    platform_fee_cents: platformFeeCents,
    tax_cents: taxCents,
    total_cents: totalCents,
    baker_name: bakerDisplayName,
  });
});
