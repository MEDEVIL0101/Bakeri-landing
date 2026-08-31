import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { sendBakerOrderEmail } from "../_shared/bakerOrderEmail.ts";
import { resolveBakerEmail } from "../_shared/bakerEmail.ts";
import { logNotification } from "../_shared/notificationLog.ts";
import { resolvePromotions, redeemPromoCode } from "../_shared/promotions.ts";

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

// The PaymentIntent this finalizes charged subtotal + tax only — a guest
// checkout doesn't add Bakeri's service charge to the customer's total (see
// create-payment-intent). platform_fee_cents is still computed and stored
// here (never trusting a client-supplied figure) so it's available to
// release-baker-payouts for platform_custody orders, or to reconcile against
// the direct charge's application_fee_amount for direct orders — either way
// it comes out of the baker's side, not the customer's.

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

// Matches by timestamp, not exact string equality — the client re-derives
// its chosen date via JS `Date#toISOString()` (always ".000Z", 3-digit ms)
// while preorder_dates as stored/returned by Postgres often has no
// milliseconds component at all (e.g. "2026-08-06T06:55:45Z"). Those two
// strings represent the identical instant but never string-match, so the
// old `dates.includes(chosenPreorderDate)` check failed every multi-date
// preorder checkout — confirmed live 2026-08-05 (Sweet Southern, "Dutch
// crunch Bread"): payment succeeded, this rejected it, failAndRelease
// correctly refunded/canceled the hold, but the baker never got an order.
// Returns the original stored string (not the client's) so callers keep
// getting the canonical value.
function matchingStoredDate(dates: string[], chosen: string | undefined): string | undefined {
  if (!chosen) return undefined;
  const chosenTime = new Date(chosen).getTime();
  if (isNaN(chosenTime)) return undefined;
  return dates.find((d) => new Date(d).getTime() === chosenTime);
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
  const matched = dates.length > 1 ? matchingStoredDate(dates, chosenPreorderDate) : undefined;
  if (matched) return matched;
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
  const stripeOpts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

  // Re-verify the PaymentIntent actually authorized (or, for deposits, fully
  // captured) — never trust the client. "requires_capture" is the expected
  // state for a regular (non-deposit) order now that create-payment-intent
  // holds funds instead of capturing immediately; "succeeded" covers deposits.
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(payment_intent_id, stripeOpts);
  } catch {
    return json({ error: "Could not verify payment." }, 400);
  }
  if (intent.status !== "succeeded" && intent.status !== "requires_capture") {
    return json({ error: `Payment not confirmed. Status: ${intent.status}` }, 400);
  }

  // From here on, Stripe has confirmed a real hold or charge exists. Every
  // failure below this point — a listing that's no longer available, a sold
  // -out preorder date, an unexpected DB error — used to just return an
  // error while leaving that hold/charge in place: the customer's card was
  // already authorized or charged, but no order existed anywhere for the
  // baker to find, and "contact the baker with this reference" was a dead
  // end since there's no way to look up a raw PaymentIntent id in-app.
  // failAndRelease releases the hold (or refunds an already-captured
  // deposit charge) before returning the error, so this can never again end
  // in the customer being charged with nothing to show for it — either the
  // order is created, or the money comes back. Mirrors cancel-order's own
  // release logic (same Stripe status branch, same ignored error codes for
  // an intent that's already been released).
  const failAndRelease = async (error: string, status = 400) => {
    try {
      const current = await stripe.paymentIntents.retrieve(payment_intent_id, stripeOpts);
      if (current.status === "succeeded") {
        await stripe.refunds.create({ payment_intent: payment_intent_id }, stripeOpts);
      } else if (current.status !== "canceled") {
        await stripe.paymentIntents.cancel(payment_intent_id, stripeOpts);
      }
    } catch (err: unknown) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.code ?? (err as any)?.raw?.code;
      const ignoredCodes = ["resource_missing", "charge_already_refunded", "payment_intent_unexpected_state"];
      if (!ignoredCodes.includes(code)) {
        // Best-effort: log so this is discoverable server-side, but still
        // return the original error below rather than masking it — a
        // failed release shouldn't also hide why the order wasn't created.
        console.error("failAndRelease: could not release payment", payment_intent_id, err);
      }
    }

    // Releasing the payment fixes the money-safety problem, but it left
    // the baker with literally nothing — the customer's only artifact was
    // a raw PaymentIntent id they had no way to look up in-app either.
    // Best-effort: leave a real order in the baker's normal pending queue
    // (same review/confirm-or-decline flow as any other order) so they can
    // see exactly who tried to order what and follow up directly, instead
    // of the attempt vanishing without a trace. lead_channel is
    // deliberately NOT "website" — that's what gates the automatic
    // "Payment processed" guest email (trg_fn_marketplace_order_notify),
    // which would be false here since the payment was just released above.
    try {
      const itemCount = cartLines.reduce((sum, l) => sum + l.quantity, 0);
      const fallbackDueDate = new Date(Date.now() + 86400000).toISOString();
      await db.from("orders").insert({
        id: crypto.randomUUID(),
        user_id: baker_id,
        order_name: `Website order (${itemCount} item${itemCount === 1 ? "" : "s"}) — needs review`,
        baker_display_name: "",
        customer_name,
        customer_phone,
        customer_email,
        due_date: fallbackDueDate,
        status: "Confirmed",
        notes: `⚠️ This customer's card was authorized then released — the order couldn't be ` +
          `completed automatically (${error}). No payment has been collected. Contact the ` +
          `customer to sort out payment and details before fulfilling, or decline if it's a dead end.`,
        is_paid: false,
        payment_note: "",
        platform_fee_cents: 0,
        deposit_amount: 0,
        deposit_note: "",
        fulfillment_type: "Pickup",
        delivery_details: "",
        is_delivery: false,
        delivery_address: null,
        color_name: "red",
        order_source: "marketplace",
        marketplace_status: "pending",
        buyer_profile_id: null,
        buyer_display_name: customer_name,
        scheduled_pickup_date: fallbackDueDate,
        payment_intent_id,
        payment_status: "authorized",
        payment_model: connectedAccountId ? "direct" : "platform_custody",
        reference_photo_count: 0,
        lead_channel: null,
        ip_address: getClientIp(req),
      });
    } catch (err: unknown) {
      console.error("failAndRelease: could not create fallback order for baker review", payment_intent_id, err);
    }

    return json({ error }, status);
  };

  // Re-fetch every listing server-side — never trust client-supplied price/name.
  const menuItemIds = cartLines.map((l) => l.menu_item_id);
  const { data: menuItems, error: menuItemErr } = await db
    .from("menu_items")
    .select(
      "id, user_id, name, default_price, marketplace_price_from, listing_kind, " +
      "is_listed_in_marketplace, is_active, tax_category, unit_weight_grams, preorder_drop_date, is_assorted_box, " +
      "preorder_schedule_mode, preorder_dates, preorder_weekday, preorder_order_cutoff_date, lead_days, max_preorder_quantity"
    )
    .in("id", menuItemIds);

  if (menuItemErr || !menuItems || menuItems.length !== menuItemIds.length) {
    return await failAndRelease("One or more items in your order are no longer available.");
  }

  const menuItemsById = new Map(menuItems.map((m) => [m.id, m]));
  const boxItemIds = menuItems.filter((m) => m.is_assorted_box).map((m) => m.id);

  // Per-date capacity — fixed_dates preorder items only, and only when the
  // baker actually set a cap (max_preorder_quantity > 0; 0 means unlimited,
  // matching MenuItem.maxPreorderQuantity's existing "0 = unlimited" semantics).
  // A date's remaining capacity is its own cap minus every non-declined/
  // non-cancelled order already committed to that exact date — never trust
  // the client, recompute fresh at checkout time just like Assorted Box's
  // tier/variant validation.
  const cappedPreorderItemIds = menuItems
    .filter((m) => m.listing_kind === "preorder" && (m.preorder_schedule_mode || "fixed_dates") === "fixed_dates" && (m.max_preorder_quantity ?? 0) > 0)
    .map((m) => m.id);
  const commitmentsByItem = new Map<string, Map<number, number>>();
  if (cappedPreorderItemIds.length > 0) {
    const { data: commitmentRows } = await db
      .from("order_items")
      .select("menu_item_id, preorder_date, quantity, order_id")
      .in("menu_item_id", cappedPreorderItemIds)
      .not("preorder_date", "is", null)
      .is("deleted_at", null);
    const rows = commitmentRows ?? [];
    const orderIds = [...new Set(rows.map((r) => r.order_id))];
    const activeOrderIds = new Set<string>();
    if (orderIds.length > 0) {
      const { data: orderRows } = await db
        .from("orders")
        .select("id, marketplace_status")
        .in("id", orderIds);
      for (const o of orderRows ?? []) {
        if (o.marketplace_status !== "declined" && o.marketplace_status !== "cancelled") activeOrderIds.add(o.id);
      }
    }
    for (const row of rows) {
      if (!activeOrderIds.has(row.order_id)) continue;
      const dateKey = new Date(row.preorder_date).getTime();
      const perItem = commitmentsByItem.get(row.menu_item_id) ?? new Map<number, number>();
      perItem.set(dateKey, (perItem.get(dateKey) ?? 0) + row.quantity);
      commitmentsByItem.set(row.menu_item_id, perItem);
    }
  }

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
    if (!item) return await failAndRelease("One or more items in your order are no longer available.");
    if (item.user_id !== baker_id) return await failAndRelease("This cart contains items from more than one baker.");
    if (!item.is_listed_in_marketplace) {
      return await failAndRelease(`"${item.name}" is no longer available.`);
    }
    if (item.listing_kind === "custom") {
      return await failAndRelease(`"${item.name}" requires a custom order request, not direct checkout.`);
    }
    if (item.listing_kind === "digital") {
      return await failAndRelease(`"${item.name}" is a digital download — buy it directly from its own page, not the cart.`);
    }
    if (item.listing_kind === "physical") {
      return await failAndRelease(`"${item.name}" ships to you — buy it from the Ships to You cart, not the pickup cart.`);
    }
    if (item.is_assorted_box) {
      const tier = (tiersByItemId.get(item.id) ?? []).find((t) => t.id === line.tier_id);
      if (!tier) return await failAndRelease(`Please choose a size for "${item.name}".`);
      const validVariantIds = new Set((variantsByItemId.get(item.id) ?? []).map((v) => v.id));
      const selections = line.variant_selections ?? [];
      if (selections.length === 0 || selections.some((s) => !validVariantIds.has(s.variant_id))) {
        return await failAndRelease(`Please choose your flavors for "${item.name}".`);
      }
      const total = selections.reduce((sum, s) => sum + s.quantity, 0);
      if (total !== tier.unit_count) {
        return await failAndRelease(`"${item.name}" needs exactly ${tier.unit_count} pieces chosen — got ${total}.`);
      }
    }
    if (item.listing_kind === "preorder") {
      const mode = item.preorder_schedule_mode || "fixed_dates";
      const now = Date.now();
      if (mode === "weekday") {
        if (!item.preorder_order_cutoff_date || now > new Date(item.preorder_order_cutoff_date).getTime()) {
          return await failAndRelease(`Ordering has closed for "${item.name}".`);
        }
      } else if (mode === "fixed_dates") {
        const dates: string[] = Array.isArray(item.preorder_dates) ? item.preorder_dates : [];
        let targetDate: string | undefined;
        if (dates.length > 1) {
          const matched = matchingStoredDate(dates, line.chosen_preorder_date);
          if (!matched) {
            return await failAndRelease(`Please choose a pickup date for "${item.name}".`);
          }
          if (new Date(matched).getTime() <= now) {
            return await failAndRelease(`That pickup date for "${item.name}" has passed — please refresh and pick another.`);
          }
          targetDate = matched;
        } else {
          const onlyDate = dates[0] ?? item.preorder_drop_date;
          if (onlyDate && new Date(onlyDate).getTime() <= now) {
            return await failAndRelease(`"${item.name}" is no longer available for pre-order.`);
          }
          targetDate = onlyDate ?? undefined;
        }
        const cap = item.max_preorder_quantity ?? 0;
        if (cap > 0 && targetDate) {
          const committed = commitmentsByItem.get(item.id)?.get(new Date(targetDate).getTime()) ?? 0;
          const remaining = Math.max(0, cap - committed);
          if (line.quantity > remaining) {
            return await failAndRelease(
              remaining > 0
                ? `Only ${remaining} left of "${item.name}" for that date.`
                : `"${item.name}" is sold out for that date — please pick another.`
            );
          }
        }
      }
      // lead_time: always open, ready date computed server-side from lead_days.
    }
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, email, is_gst_registered, pickup_province")
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

  // Apply the same percent-off promotion the PaymentIntent was charged
  // under (see create-payment-intent) before tax + subtotal are derived, so
  // the recorded pickup order matches the charge. Automatic sales resolve
  // from the code = null path; a coded promo rides the PI metadata.
  {
    const promo = await resolvePromotions(
      baker_id,
      lines.map((l) => ({
        menu_item_id: l.item.id, listing_kind: l.item.listing_kind,
        unit_price_cents: Math.round(l.pricePerUnit * 100), quantity: l.quantity,
      })),
      (intent.metadata?.promo_code as string) ?? null,
    );
    promo.lines.forEach((rl, i) => { lines[i].pricePerUnit = rl.effective_unit_price_cents / 100; });
    await redeemPromoCode(promo.codeStatus === "valid" ? promo.codePromotionId : null, payment_intent_id);
  }

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
  // Fee is on the pre-tax item subtotal — comes out of the baker's cut, not
  // added to what the customer was actually charged (subtotal + tax only).
  const platformFeeCents = Math.round(subtotalCents * PLATFORM_FEE_RATE);
  const totalCents = subtotalCents + taxCents;

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
    payment_note: `Subtotal: $${(subtotalCents / 100).toFixed(2)}, Tax: $${(taxCents / 100).toFixed(2)}, Total charged: $${(totalCents / 100).toFixed(2)} (Bakeri service charge: $${(platformFeeCents / 100).toFixed(2)}, deducted from your payout)`,
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
    return await failAndRelease("Something went wrong. Please try again.");
  }

  const { error: itemErr } = await db.from("order_items").insert(
    lines.map((l) => ({
      id: crypto.randomUUID(),
      user_id: baker_id,
      order_id: orderId,
      recipe_id: null,
      menu_item_id: l.item.id,
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
    // The orders row above already committed — without this, a customer
    // who hit this path would have their card charged/held AND a headless
    // "pending" order with zero items sitting in the baker's queue: not
    // visible/actionable there (nothing to confirm), yet not cleanly
    // refunded either. Delete it so failAndRelease's refund/cancel is the
    // only trace left, matching every other failure path here.
    await db.from("orders").delete().eq("id", orderId);
    return await failAndRelease("Something went wrong. Please try again.");
  }

  // Best-effort, never blocks the response — the order is already recorded
  // and paid (authorized) either way. Fires for every kind sold through this
  // endpoint (ready_now and preorder) at the same moment the baker already
  // gets a push notification for it (see trg_fn_marketplace_order_notify) —
  // this is just the email counterpart of that same "new order" signal.
  const bakerEmail = await resolveBakerEmail(db, baker_id, bakerProfile?.email);
  if (bakerEmail) {
    const result = await sendBakerOrderEmail({
      db,
      bakerId: baker_id,
      bakerEmail,
      items: lines.map((l) => ({
        custom_name: l.tierLabel ? `${l.item.name} — ${l.tierLabel}` : l.item.name,
        quantity: l.quantity,
        price_per_unit: l.pricePerUnit,
        menu_item_id: l.item.id,
        variant_breakdown: l.variantBreakdown,
      })),
      customerName: customer_name,
      customerEmail: customer_email,
      customerPhone: customer_phone,
      totalCents,
      kind: "sale",
    });
    await logNotification(db, orderId, "baker_sale_email", result.ok ? "sent" : "failed", result.error);
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
