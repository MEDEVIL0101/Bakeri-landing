import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint for the combined digital+shipping leg of
// checkout.html's guest cart. Digital and physical listings both capture
// instantly with no baker-accept step (see create-payment-intent's
// isInstantCaptureCart), so as of 2026-08-24 they settle as ONE PaymentIntent
// instead of two sequential ones — this is that PaymentIntent's single
// finalize call, doing the combined work finalize-guest-digital-order and
// finalize-guest-physical-order each do on their own for a single-kind cart.
//
// finalize-guest-digital-order and finalize-guest-physical-order are
// UNCHANGED and still handle the single-kind case (digital-checkout.html,
// physical-checkout.html, and a checkout.html cart with only one of the two
// present) — this function only exists for the case where BOTH are present
// in the same cart. It always writes TWO order rows (one 'Digital'/
// completed, one 'Shipping'/awaiting_shipment) sharing one payment_intent_id
// — not one merged row — since those two fulfillment types have genuinely
// different downstream lifecycles (mark-order-shipped only applies to the
// physical one) and every other screen that reads `orders` already expects a
// single fulfillment_type per row.
//
// Settlement (baker_transfer_id/stripe_fee_cents/baker_payout_cents) is read
// ONCE against the real combined PaymentIntent, then split between the two
// order rows in proportion to each leg's own share of the total charged —
// reading it separately per row (like the single-kind functions do) would
// double-count the same amount_received against both rows.

import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement } from "../_shared/settlement.ts";
import { sendBakerOrderEmail } from "../_shared/bakerOrderEmail.ts";
import { resolveBakerEmail } from "../_shared/bakerEmail.ts";
import { logNotification } from "../_shared/notificationLog.ts";
import { postWithRetry } from "../_shared/postWithRetry.ts";
import { resolvePromotions, redeemPromoCode } from "../_shared/promotions.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

const stripe = getStripeClient();

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365; // 1 year — matches finalize-guest-digital-order (see the rationale there)

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

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

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// A plain <a href="signedUrl"> just navigates to the file — for a PDF or
// image, most browsers render it inline instead of downloading it, replacing
// the whole page the buyer was just looking at. Passing `download` here
// makes Supabase Storage answer with Content-Disposition: attachment, which
// is what actually makes a click trigger a real save-file download regardless
// of file type or browser — a client-side `download` attribute on the link
// can't do this reliably since the URL is cross-origin (storage.supabase.co,
// not bakeriapp.com). Named after the item (not the raw storage path, which
// is a content-hashed filename) so what lands in the buyer's Downloads
// folder is legible. Same helper as finalize-guest-digital-order.
function buildDownloadFilename(itemName: string, filePath: string): string {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const safeName = (itemName || "download").replace(/[\/\\?%*:|"<>]/g, "-").trim() || "download";
  return ext && ext !== filePath ? `${safeName}.${ext}` : safeName;
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

interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
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
  const requestedDigitalLines: { menu_item_id: string; variant_id: string | null }[] = Array.isArray(body.digital_items)
    ? (body.digital_items as Record<string, unknown>[])
        .map((i) => ({ menu_item_id: String(i.id ?? "").trim(), variant_id: i.variant_id ? String(i.variant_id).trim() : null }))
        .filter((i) => i.menu_item_id)
    : [];
  const requestedPhysicalItems: { menu_item_id: string; quantity: number; variant_id: string | null }[] = Array.isArray(body.physical_items)
    ? (body.physical_items as Record<string, unknown>[])
        .map((i) => ({
          menu_item_id: String(i.menu_item_id ?? "").trim(),
          quantity: Math.floor(Number(i.quantity) || 0),
          variant_id: i.variant_id ? String(i.variant_id).trim() : null,
        }))
        .filter((i) => i.menu_item_id && i.quantity > 0)
    : [];
  const customer_name = String(body.customer_name ?? "").trim();
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();
  const rawAddress = (body.shipping_address ?? {}) as Record<string, unknown>;
  const shipping_address: ShippingAddress = {
    name: String(rawAddress.name ?? "").trim(),
    line1: String(rawAddress.line1 ?? "").trim(),
    line2: String(rawAddress.line2 ?? "").trim(),
    city: String(rawAddress.city ?? "").trim(),
    province: String(rawAddress.province ?? "").trim(),
    postal_code: String(rawAddress.postal_code ?? "").trim(),
    country: String(rawAddress.country ?? "").trim(),
  };

  if (!payment_intent_id) return json({ error: "Invalid request." }, 400);
  if (requestedDigitalLines.length === 0 && requestedPhysicalItems.length === 0) {
    return json({ error: "Invalid request." }, 400);
  }
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);
  if (requestedPhysicalItems.length > 0 && (
    !shipping_address.name || !shipping_address.line1 || !shipping_address.city ||
    !shipping_address.province || !shipping_address.postal_code || !shipping_address.country
  )) {
    return json({ error: "Please enter the full shipping address." }, 400);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const digitalMenuItemIds = [...new Set(requestedDigitalLines.map((l) => l.menu_item_id))];
  const physicalMenuItemIds = [...new Set(requestedPhysicalItems.map((i) => i.menu_item_id))];
  const allMenuItemIds = [...new Set([...digitalMenuItemIds, ...physicalMenuItemIds])];

  // Re-fetch every listing server-side — never trust client-supplied price/name.
  const { data: menuItemRows, error: itemsErr } = await db
    .from("menu_items")
    .select("id, user_id, name, default_price, marketplace_price_from, listing_kind, is_listed_in_marketplace, digital_file_path, available_qty_today, unit, shipping_fee, shipping_always_full_price, has_variants")
    .in("id", allMenuItemIds);

  if (itemsErr || !menuItemRows || menuItemRows.length !== allMenuItemIds.length) {
    return json({ error: "One of these items is no longer available." }, 400);
  }
  const itemsById = new Map(menuItemRows.map((i) => [i.id as string, i]));
  if (digitalMenuItemIds.some((id) => itemsById.get(id)?.listing_kind !== "digital")) {
    return json({ error: "One of these items is not a digital download." }, 400);
  }
  if (physicalMenuItemIds.some((id) => itemsById.get(id)?.listing_kind !== "physical")) {
    return json({ error: "One of these items isn't a shippable item." }, 400);
  }
  const bakerIds = new Set(menuItemRows.map((i) => i.user_id));
  if (bakerIds.size !== 1) {
    return json({ error: "These items are from different bakers and can't be checked out together." }, 400);
  }
  const bakerId = menuItemRows[0].user_id as string;

  const variantMenuItemIds = [...new Set([...requestedDigitalLines, ...requestedPhysicalItems].filter((l) => l.variant_id).map((l) => l.menu_item_id))];
  const { data: variantRows } = variantMenuItemIds.length
    ? await db.from("listing_variants").select("id, menu_item_id, label, price, stock_qty").in("menu_item_id", variantMenuItemIds).is("deleted_at", null)
    : { data: [] as { id: string; menu_item_id: string; label: string; price: number; stock_qty: number }[] };
  const variantsById = new Map((variantRows ?? []).map((v) => [v.id, v]));

  interface DigitalLine { menuItemId: string; name: string; variantId: string | null; variantLabel: string | null; unitPriceCents: number; digitalFilePath: string | null; }
  const digitalLines: DigitalLine[] = [];
  for (const req of requestedDigitalLines) {
    const menuItem = itemsById.get(req.menu_item_id)!;
    if (req.variant_id) {
      const variant = variantsById.get(req.variant_id);
      if (!variant || variant.menu_item_id !== req.menu_item_id) {
        return json({ error: `"${menuItem.name}" — that option is no longer available.` }, 400);
      }
      digitalLines.push({
        menuItemId: req.menu_item_id, name: `${menuItem.name} — ${variant.label}`,
        variantId: variant.id, variantLabel: variant.label,
        unitPriceCents: Math.round(variant.price * 100), digitalFilePath: menuItem.digital_file_path,
      });
    } else {
      digitalLines.push({
        menuItemId: req.menu_item_id, name: menuItem.name, variantId: null, variantLabel: null,
        unitPriceCents: Math.round((((menuItem.marketplace_price_from ?? 0) > 0 ? menuItem.marketplace_price_from : menuItem.default_price) ?? 0) * 100),
        digitalFilePath: menuItem.digital_file_path,
      });
    }
  }

  interface PhysicalLine { menuItemId: string; name: string; quantity: number; variantId: string | null; variantLabel: string | null; unitPriceCents: number; unit: string; }
  const physicalLines: PhysicalLine[] = [];
  for (const req of requestedPhysicalItems) {
    const menuItem = itemsById.get(req.menu_item_id)!;
    if (req.variant_id) {
      const variant = variantsById.get(req.variant_id);
      if (!variant || variant.menu_item_id !== req.menu_item_id) {
        return json({ error: `"${menuItem.name}" — that option is no longer available.` }, 400);
      }
      physicalLines.push({
        menuItemId: req.menu_item_id, name: `${menuItem.name} — ${variant.label}`, quantity: req.quantity,
        variantId: variant.id, variantLabel: variant.label,
        unitPriceCents: Math.round(variant.price * 100), unit: menuItem.unit || "item",
      });
    } else {
      physicalLines.push({
        menuItemId: req.menu_item_id, name: menuItem.name, quantity: req.quantity,
        variantId: null, variantLabel: null,
        unitPriceCents: Math.round((((menuItem.marketplace_price_from ?? 0) > 0 ? menuItem.marketplace_price_from : menuItem.default_price) ?? 0) * 100),
        unit: menuItem.unit || "item",
      });
    }
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, email, stripe_connect_account_id, shipping_free_over_threshold, shipping_additional_item_percent")
    .eq("id", bakerId)
    .single();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";
  const connectedAccountId = bakerProfile?.stripe_connect_account_id ?? null;
  const shippingFreeOverThreshold = bakerProfile?.shipping_free_over_threshold ?? 0;
  const shippingAdditionalItemPercent = bakerProfile?.shipping_additional_item_percent ?? 100;

  // Always a direct charge on the baker's own connected account — same
  // reasoning as the single-kind finalize functions. Never trust the client
  // alone on payment success.
  let intent;
  try {
    intent = connectedAccountId
      ? await stripe.paymentIntents.retrieve(payment_intent_id, { stripeAccount: connectedAccountId })
      : await stripe.paymentIntents.retrieve(payment_intent_id);
  } catch {
    return json({ error: "Could not verify payment." }, 400);
  }
  if (intent.status !== "succeeded") {
    return json({ error: `Payment not confirmed. Status: ${intent.status}` }, 400);
  }

  // Past this point the charge is confirmed real. Since it's one combined
  // charge for both legs, any failure that can't be worked around refunds
  // the WHOLE thing — same all-or-nothing contract the single-kind
  // functions use, just covering both legs at once instead of one.
  async function refundAndFail(errorMessage: string) {
    let refunded = false;
    try {
      await stripe.refunds.create(
        { payment_intent: payment_intent_id },
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
      );
      refunded = true;
    } catch (err) {
      console.error("auto-refund failed:", err instanceof Error ? err.message : err);
    }
    return json({
      error: refunded
        ? "We couldn't complete your order, so your payment was automatically refunded. Please try again, or contact the baker if you don't see the refund within a few days."
        : errorMessage + " Your payment could not be automatically refunded — contact the baker with this reference: " + payment_intent_id,
    }, 400);
  }

  const missingFile = digitalLines.find((l) => !l.digitalFilePath);
  if (missingFile) return refundAndFail(`"${missingFile.name}" has no file attached.`);

  // Atomic, all-or-nothing stock decrement per source, same as
  // finalize-guest-physical-order — the real "enough left?" check.
  if (physicalLines.length > 0) {
    const plainLines = physicalLines.filter((l) => !l.variantId);
    const variantLines = physicalLines.filter((l) => l.variantId);
    if (plainLines.length > 0) {
      const { error: stockErr } = await db.rpc("decrement_menu_item_stock_batch", {
        p_items: plainLines.map((l) => ({ id: l.menuItemId, qty: l.quantity })),
      });
      if (stockErr) {
        console.error("decrement_menu_item_stock_batch failed:", stockErr.message);
        return refundAndFail("One of these items sold out just now.");
      }
    }
    if (variantLines.length > 0) {
      const { error: variantStockErr } = await db.rpc("decrement_listing_variant_stock_batch", {
        p_items: variantLines.map((l) => ({ id: l.variantId, qty: l.quantity })),
      });
      if (variantStockErr) {
        console.error("decrement_listing_variant_stock_batch failed:", variantStockErr.message);
        return refundAndFail("One of these options sold out just now.");
      }
    }
  }

  // Apply the same percent-off promotion the PaymentIntent was charged
  // under (see create-payment-intent) across both legs, so the recorded
  // order matches the charge. One resolve call covers digital + physical.
  {
    const promoInput = [
      ...digitalLines.map((l) => ({ menu_item_id: l.menuItemId, listing_kind: "digital", unit_price_cents: l.unitPriceCents, quantity: 1 })),
      ...physicalLines.map((l) => ({ menu_item_id: l.menuItemId, listing_kind: "physical", unit_price_cents: l.unitPriceCents, quantity: l.quantity })),
    ];
    const promo = await resolvePromotions(bakerId, promoInput, (intent.metadata?.promo_code as string) ?? null);
    promo.lines.forEach((rl, i) => {
      if (i < digitalLines.length) digitalLines[i].unitPriceCents = rl.effective_unit_price_cents;
      else physicalLines[i - digitalLines.length].unitPriceCents = rl.effective_unit_price_cents;
    });
    await redeemPromoCode(promo.codeStatus === "valid" ? promo.codePromotionId : null, payment_intent_id);
  }

  const digitalSubtotalCents = digitalLines.reduce((sum, l) => sum + l.unitPriceCents, 0);
  const physicalSubtotalCents = physicalLines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);

  // Same combined-shipping rule as finalize-guest-physical-order, scoped to
  // just the physical lines here (digital lines never carry a shipping fee).
  const shippingFreeOverThresholdCents = Math.round(shippingFreeOverThreshold * 100);
  const distinctPhysicalMenuItemIds = [...new Set(physicalLines.map((l) => l.menuItemId))];
  function computeShippingFeeCents(): number {
    if (distinctPhysicalMenuItemIds.length === 0) return 0;
    let highestId = distinctPhysicalMenuItemIds[0];
    let highestFeeCents = Math.round((itemsById.get(highestId)?.shipping_fee ?? 0) * 100);
    for (const id of distinctPhysicalMenuItemIds) {
      const feeCents = Math.round((itemsById.get(id)?.shipping_fee ?? 0) * 100);
      if (feeCents > highestFeeCents) { highestFeeCents = feeCents; highestId = id; }
    }
    return distinctPhysicalMenuItemIds.reduce((sum, id) => {
      const item = itemsById.get(id);
      const feeCents = Math.round((item?.shipping_fee ?? 0) * 100);
      if (id === highestId) return sum + feeCents;
      if (item?.shipping_always_full_price) return sum + feeCents;
      return sum + Math.round(feeCents * shippingAdditionalItemPercent / 100);
    }, 0);
  }
  const shippingFeeCents = (shippingFreeOverThresholdCents > 0 && physicalSubtotalCents >= shippingFreeOverThresholdCents)
    ? 0
    : computeShippingFeeCents();

  const digitalTotalCents = digitalSubtotalCents;
  const physicalTotalCents = physicalSubtotalCents + shippingFeeCents;
  const combinedSubtotalCents = digitalSubtotalCents + physicalSubtotalCents;
  // Guest checkout: buyer pays exactly the item price(s) plus shipping —
  // Bakeri's one service charge (computed off the combined item subtotal,
  // same fee base create-payment-intent used for the actual charge) comes
  // out of the baker's cut instead. Split between the two order rows below
  // in proportion to each leg's own subtotal share, purely for each row's
  // own record-keeping — the real, single application_fee already collected
  // on the PaymentIntent doesn't change either way.
  const combinedPlatformFeeCents = Math.round(combinedSubtotalCents * PLATFORM_FEE_RATE);
  const digitalPlatformFeeCents = combinedSubtotalCents > 0 ? Math.round(combinedPlatformFeeCents * digitalSubtotalCents / combinedSubtotalCents) : 0;
  const physicalPlatformFeeCents = combinedPlatformFeeCents - digitalPlatformFeeCents;

  // Settlement is read ONCE against the real, combined PaymentIntent — its
  // amount_received/stripe fee cover BOTH legs together, so reading it twice
  // (once per order row, like the single-kind functions each do for their
  // own always-1:1 PaymentIntent) would have each row claim the full
  // baker_payout_cents independently and double it in total. Split
  // proportionally by each leg's own share of what the buyer actually paid
  // (subtotal + shipping for physical, subtotal alone for digital) so the
  // two rows sum back to the true total instead of each claiming it whole.
  const combinedSettlement = connectedAccountId
    ? await readDirectChargeSettlement(stripe, payment_intent_id, connectedAccountId, combinedPlatformFeeCents)
    : null;
  const totalChargedCents = digitalTotalCents + physicalTotalCents;
  function splitSettlement(shareCents: number): Record<string, unknown> | null {
    if (!combinedSettlement) return null;
    const fraction = totalChargedCents > 0 ? shareCents / totalChargedCents : 0;
    const stripeFeeTotal = (combinedSettlement.stripe_fee_cents as number) ?? 0;
    const payoutTotal = (combinedSettlement.baker_payout_cents as number) ?? 0;
    return {
      baker_transfer_id: combinedSettlement.baker_transfer_id,
      baker_transferred_at: combinedSettlement.baker_transferred_at,
      stripe_fee_cents: Math.round(stripeFeeTotal * fraction),
      baker_payout_cents: Math.round(payoutTotal * fraction),
    };
  }
  const digitalSettlement = digitalLines.length > 0 ? splitSettlement(digitalTotalCents) : null;
  const physicalSettlement = physicalLines.length > 0 ? splitSettlement(physicalTotalCents) : null;

  // One download entry per cart line, labelled with what the buyer chose;
  // each distinct file signed once and the URL reused across shared-file
  // variant lines, per-line `&download=` name appended after signing — same
  // reasoning as finalize-guest-digital-order.
  const signedByPath = new Map<string, string>();
  for (const path of new Set(digitalLines.map((l) => l.digitalFilePath as string))) {
    const { data: signedUrlData, error: signedUrlErr } = await db.storage
      .from("digital-products")
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (signedUrlErr || !signedUrlData?.signedUrl) {
      console.error("createSignedUrl failed:", path, signedUrlErr?.message);
      return refundAndFail("We couldn't prepare your download.");
    }
    signedByPath.set(path, signedUrlData.signedUrl);
  }
  const downloads: { item_name: string; download_url: string; menu_item_id: string }[] = digitalLines.map((line) => {
    const path = line.digitalFilePath as string;
    return {
      item_name: line.name,
      download_url: `${signedByPath.get(path)}&download=${encodeURIComponent(buildDownloadFilename(line.name, path))}`,
      menu_item_id: line.menuItemId,
    };
  });

  const clientIp = getClientIp(req);
  const now = new Date().toISOString();
  let digitalOrderId: string | null = null;
  let physicalOrderId: string | null = null;

  if (digitalLines.length > 0) {
    digitalOrderId = crypto.randomUUID();
    const orderName = digitalLines.length === 1 ? digitalLines[0].name : `${digitalLines[0].name} + ${digitalLines.length - 1} more`;
    const { error: orderErr } = await db.from("orders").insert({
      id: digitalOrderId,
      user_id: bakerId,
      order_name: orderName,
      baker_display_name: bakerDisplayName,
      customer_name,
      customer_phone: "",
      customer_email,
      due_date: now,
      status: "Confirmed",
      notes: "",
      is_paid: true,
      payment_note: `Total charged: $${(digitalTotalCents / 100).toFixed(2)} (Bakeri service charge: $${(digitalPlatformFeeCents / 100).toFixed(2)}, deducted from your payout) — paid together with a shipping order in the same checkout`,
      platform_fee_cents: digitalPlatformFeeCents,
      deposit_amount: 0,
      deposit_note: "",
      fulfillment_type: "Digital",
      delivery_details: "",
      is_delivery: false,
      delivery_address: null,
      created_at: now,
      updated_at: now,
      color_name: "green",
      order_source: "marketplace",
      marketplace_status: "completed",
      completed_at: now,
      buyer_profile_id: null,
      buyer_display_name: customer_name,
      scheduled_pickup_date: null,
      payment_intent_id,
      payment_status: "captured",
      payment_model: connectedAccountId ? "direct" : "platform_custody",
      reference_photo_count: 0,
      lead_channel: "website",
      ip_address: clientIp,
      ...(digitalSettlement ?? {}),
    });
    if (orderErr) {
      console.error("digital orders insert failed:", orderErr.message);
      return refundAndFail("Something went wrong recording your order.");
    }
    const { error: itemInsertErr } = await db.from("order_items").insert(
      digitalLines.map((line) => ({
        id: crypto.randomUUID(),
        user_id: bakerId,
        order_id: digitalOrderId,
        recipe_id: null,
        // Recorded so resend-digital-download can resolve this line straight
        // back to its file instead of falling back to a listing-name match.
        menu_item_id: line.menuItemId,
        custom_name: line.name,
        quantity: 1,
        unit: "download",
        price_per_unit: line.unitPriceCents / 100,
        variant_id: line.variantId,
        variant_label: line.variantLabel,
        notes: "",
        updated_at: now,
      }))
    );
    if (itemInsertErr) console.error("digital order_items insert failed:", itemInsertErr.message);
  }

  const physicalAddressLines = physicalLines.length > 0 ? [
    shipping_address.name,
    shipping_address.line1,
    shipping_address.line2,
    [shipping_address.city, shipping_address.province, shipping_address.postal_code].filter(Boolean).join(", "),
    shipping_address.country,
  ].filter(Boolean) : [];
  const physicalOrderName = physicalLines.length === 1 ? physicalLines[0].name : (physicalLines.length > 1 ? `${physicalLines[0].name} + ${physicalLines.length - 1} more` : "");

  if (physicalLines.length > 0) {
    physicalOrderId = crypto.randomUUID();
    const { error: orderErr } = await db.from("orders").insert({
      id: physicalOrderId,
      user_id: bakerId,
      order_name: physicalOrderName,
      baker_display_name: bakerDisplayName,
      customer_name,
      customer_phone: "",
      customer_email,
      due_date: now,
      status: "Confirmed",
      notes: "",
      is_paid: true,
      payment_note: `Total charged: $${(physicalTotalCents / 100).toFixed(2)} (Bakeri service charge: $${(physicalPlatformFeeCents / 100).toFixed(2)}, deducted from your payout) — paid together with a digital order in the same checkout`,
      platform_fee_cents: physicalPlatformFeeCents,
      deposit_amount: 0,
      deposit_note: "",
      fulfillment_type: "Shipping",
      delivery_details: physicalAddressLines.join("\n"),
      is_delivery: false,
      delivery_address: null,
      shipping_address,
      created_at: now,
      updated_at: now,
      color_name: "green",
      order_source: "marketplace",
      marketplace_status: "awaiting_shipment",
      completed_at: null,
      buyer_profile_id: null,
      buyer_display_name: customer_name,
      scheduled_pickup_date: null,
      payment_intent_id,
      payment_status: "captured",
      payment_model: connectedAccountId ? "direct" : "platform_custody",
      reference_photo_count: 0,
      lead_channel: "website",
      ip_address: clientIp,
      ...(physicalSettlement ?? {}),
    });
    if (orderErr) {
      console.error("physical orders insert failed:", orderErr.message);
      // Stock is already decremented and the charge already captured, and
      // (if present) the digital order above is already recorded — refunding
      // now would leave both in a worse state than just surfacing the
      // reference, same reasoning as finalize-guest-physical-order.
      return json({
        error: "Payment succeeded but we had trouble recording part of your order — contact the baker with this reference: " + payment_intent_id,
      }, 400);
    }
    const physicalOrderItemsPayload = physicalLines.map((line) => ({
      id: crypto.randomUUID(),
      user_id: bakerId,
      order_id: physicalOrderId,
      recipe_id: null,
      custom_name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      price_per_unit: line.unitPriceCents / 100,
      variant_id: line.variantId,
      variant_label: line.variantLabel,
      notes: "",
      updated_at: now,
    }));
    const { error: itemInsertErr } = await db.from("order_items").insert(physicalOrderItemsPayload);
    if (itemInsertErr) console.error("physical order_items insert failed:", itemInsertErr.message);

    // Shipping confirmation email — sent from here directly, same as
    // finalize-guest-physical-order (no client-generated artifact to shuttle
    // back, unlike the digital download links below).
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const itemRows = physicalOrderItemsPayload
        .map((i) => `<tr><td style="padding:6px 0;">${i.quantity}× ${escapeHtml(i.custom_name)}</td><td style="padding:6px 0;text-align:right;">$${(i.price_per_unit * i.quantity).toFixed(2)}</td></tr>`)
        .join("");
      const shippingRow = shippingFeeCents > 0
        ? `<tr><td style="padding:6px 0;color:#6B5F54;">Shipping</td><td style="padding:6px 0;text-align:right;color:#6B5F54;">$${(shippingFeeCents / 100).toFixed(2)}</td></tr>`
        : "";
      const totalRow = `<tr><td style="padding:6px 0;font-weight:700;">Total</td><td style="padding:6px 0;text-align:right;font-weight:700;">$${(physicalTotalCents / 100).toFixed(2)}</td></tr>`;
      const addressHtml = physicalAddressLines.map((l) => escapeHtml(l)).join("<br/>");
      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
          <h2 style="margin:0 0 8px;">Your order will ship soon</h2>
          <p style="color:#6B5F54;line-height:1.5;">
            Thanks for your purchase from ${escapeHtml(bakerDisplayName)} — ${escapeHtml(physicalOrderName)} will ship to the address below.
          </p>
          <p style="line-height:1.6;margin-top:16px;">📦 ${addressHtml}</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;border-top:1px solid #E8E4DC;padding-top:12px;">
            ${itemRows}${shippingRow}${totalRow}
          </table>
          <p style="color:#A89B8C;font-size:12px;margin-top:24px;">Order reference: ${physicalOrderId.replace(/-/g, "").slice(0, 8).toUpperCase()}</p>
        </div>
      `;
      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
          body: JSON.stringify({
            from: "Bakerï <hello@bakeriapp.com>",
            to: customer_email,
            subject: `Order confirmed — ${physicalOrderName}`,
            html,
          }),
        });
        if (!resendRes.ok) console.error("Resend send failed:", await resendRes.text());
      } catch (err) {
        console.error("Resend send threw:", err instanceof Error ? err.message : err);
      }
    }
  }

  // Baker notifications — one email + one push per leg present, same shape
  // as each single-kind finalize function sends on its own. Kept as two
  // separate notifications (rather than one combined one) since they're
  // genuinely two different order rows the baker needs to act on
  // differently — the physical one needs shipping, the digital one doesn't.
  const bakerEmail = await resolveBakerEmail(db, bakerId, bakerProfile?.email);
  if (digitalOrderId) {
    if (bakerEmail) {
      const result = await sendBakerOrderEmail({
        db, bakerId, bakerEmail,
        items: digitalLines.map((line) => ({ custom_name: line.name, quantity: 1, price_per_unit: line.unitPriceCents / 100, menu_item_id: line.menuItemId })),
        customerName: customer_name, customerEmail: customer_email,
        totalCents: digitalTotalCents, kind: "sale",
      });
      await logNotification(db, digitalOrderId, "baker_sale_email", result.ok ? "sent" : "failed", result.error);
    }
    const orderName = digitalLines.length === 1 ? digitalLines[0].name : `${digitalLines[0].name} + ${digitalLines.length - 1} more`;
    const pushResult = await postWithRetry(
      `${SUPABASE_URL}/functions/v1/notify-marketplace`,
      { recipient_user_id: bakerId, title: "🎉 New Sale!", body: `${customer_name} bought ${orderName}`, data: { type: "new_order", order_id: digitalOrderId } },
      { anonKey: SUPABASE_ANON_KEY, webhookSecret: WEBHOOK_SECRET }
    );
    await logNotification(db, digitalOrderId, "baker_new_sale_push", pushResult.ok ? "sent" : "failed", pushResult.error, "push");
  }
  if (physicalOrderId) {
    if (bakerEmail) {
      const result = await sendBakerOrderEmail({
        db, bakerId, bakerEmail,
        items: physicalLines.map((line) => ({ custom_name: line.name, quantity: line.quantity, price_per_unit: line.unitPriceCents / 100, menu_item_id: line.menuItemId })),
        customerName: customer_name, customerEmail: customer_email,
        addressLines: physicalAddressLines, totalCents: physicalTotalCents, kind: "sale",
      });
      await logNotification(db, physicalOrderId, "baker_sale_email", result.ok ? "sent" : "failed", result.error);
    }
    const pushResult = await postWithRetry(
      `${SUPABASE_URL}/functions/v1/notify-marketplace`,
      { recipient_user_id: bakerId, title: "📦 New Order!", body: `${customer_name} ordered ${physicalOrderName} — pack & ship it!`, data: { type: "new_order", order_id: physicalOrderId } },
      { anonKey: SUPABASE_ANON_KEY, webhookSecret: WEBHOOK_SECRET }
    );
    await logNotification(db, physicalOrderId, "baker_new_sale_push", pushResult.ok ? "sent" : "failed", pushResult.error, "push");
  }

  return json({
    baker_name: bakerDisplayName,
    downloads,
    digital_order_id: digitalOrderId,
    physical_order_id: physicalOrderId,
    physical_items: physicalLines.map((l) => ({ item_name: l.name, quantity: l.quantity, price_per_unit: l.unitPriceCents / 100 })),
    digital_subtotal_cents: digitalSubtotalCents,
    physical_subtotal_cents: physicalSubtotalCents,
    shipping_fee_cents: shippingFeeCents,
    total_cents: totalChargedCents,
    expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS,
  });
});
