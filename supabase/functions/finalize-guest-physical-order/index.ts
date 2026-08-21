import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint for a baker's storefront (baker/index.html
// "Ships to You" feed, baker/physical-checkout.html, and the ship leg of
// checkout.html) — records a guest's already-paid physical purchase and
// atomically decrements stock in the same call, since there's no baker
// accept step to catch an oversell later.
//
// Unlike create-guest-marketplace-order (ready_now/preorder, pending-until-
// baker-accepts), a physical (ships) sale is sold outright the moment
// payment succeeds — same reasoning as finalize-guest-digital-order, except
// stock-bound instead of unlimited-copy: decrement_menu_item_stock_batch
// (20260820000001_physical_products.sql) does the real, atomic "enough
// left?" check that create-payment-intent's pre-charge validation can only
// approximate.
//
// A ship cart can hold multiple items but is always single-baker (its own
// storefront mini-cart) — see create-payment-intent's isPhysical handling.

import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement } from "../_shared/settlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

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
  const requestedItems: { menu_item_id: string; quantity: number }[] = Array.isArray(body.items)
    ? (body.items as Record<string, unknown>[])
        .map((i) => ({ menu_item_id: String(i.menu_item_id ?? "").trim(), quantity: Math.floor(Number(i.quantity) || 0) }))
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

  if (!payment_intent_id || requestedItems.length === 0) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!shipping_address.name || !shipping_address.line1 || !shipping_address.city ||
      !shipping_address.province || !shipping_address.postal_code || !shipping_address.country) {
    return json({ error: "Please enter the full shipping address." }, 400);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const menuItemIds = requestedItems.map((i) => i.menu_item_id);

  // Re-fetch every listing server-side — never trust client-supplied price/name.
  const { data: items, error: itemsErr } = await db
    .from("menu_items")
    .select("id, user_id, name, default_price, marketplace_price_from, listing_kind, is_listed_in_marketplace, available_qty_today, unit, shipping_fee")
    .in("id", menuItemIds);

  if (itemsErr || !items || items.length !== menuItemIds.length) {
    return json({ error: "One of these items is no longer available." }, 400);
  }
  if (items.some((i) => i.listing_kind !== "physical")) {
    return json({ error: "One of these items isn't a shippable item." }, 400);
  }
  const bakerIds = new Set(items.map((i) => i.user_id));
  if (bakerIds.size !== 1) {
    return json({ error: "These items are from different bakers and can't be checked out together." }, 400);
  }

  const bakerId = items[0].user_id as string;
  const qtyById = new Map(requestedItems.map((i) => [i.menu_item_id, i.quantity]));

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, stripe_connect_account_id")
    .eq("id", bakerId)
    .single();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";
  const connectedAccountId = bakerProfile?.stripe_connect_account_id ?? null;

  // A ship cart is always single-baker, so the PaymentIntent
  // create-payment-intent made for this was a direct charge on that baker's
  // own connected account — verification must target the same account.
  // Never trust the client alone on payment success.
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

  // Past this point the charge is confirmed real. Only a genuine stock
  // shortfall (caught atomically below) falls back to a refund — anything
  // else the buyer already paid for should still be delivered/recorded.
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

  // Atomic, all-or-nothing stock decrement — one Postgres transaction, so a
  // mid-batch shortfall rolls back every decrement already applied in this
  // call. This is the real "enough left?" check; create-payment-intent's
  // pre-charge validation can only approximate it against a stale read.
  const { error: stockErr } = await db.rpc("decrement_menu_item_stock_batch", {
    p_items: items.map((i) => ({ id: i.id, qty: qtyById.get(i.id as string) ?? 0 })),
  });
  if (stockErr) {
    console.error("decrement_menu_item_stock_batch failed:", stockErr.message);
    return refundAndFail("One of these items sold out just now.");
  }

  const priceCentsById = new Map(
    items.map((i) => [
      i.id,
      Math.round(((i.marketplace_price_from ?? 0) > 0 ? i.marketplace_price_from : i.default_price) * 100),
    ])
  );
  const subtotalCents = items.reduce(
    (sum, i) => sum + (priceCentsById.get(i.id) ?? 0) * (qtyById.get(i.id as string) ?? 0),
    0
  );
  // Flat manual fee, once per distinct listing (not per unit) — same
  // reasoning as the storefront cart total. Re-derived here from the
  // baker's own listing rather than trusted from the client.
  const shippingFeeCents = items.reduce(
    (sum, i) => sum + Math.round((i.shipping_fee ?? 0) * 100),
    0
  );
  // Guest checkout: buyer pays exactly the item price(s) plus shipping —
  // Bakeri's service charge comes out of the baker's cut instead (see
  // create-payment-intent), computed off the item subtotal only, same as
  // tax/shipping never being part of that base elsewhere in the app.
  const platformFeeCents = Math.round(subtotalCents * PLATFORM_FEE_RATE);
  const totalCents = subtotalCents + shippingFeeCents;

  const settlement = connectedAccountId
    ? await readDirectChargeSettlement(stripe, payment_intent_id, connectedAccountId, platformFeeCents)
    : null;

  const orderName = items.length === 1 ? items[0].name : `${items[0].name} + ${items.length - 1} more`;

  const addressLines = [
    shipping_address.name,
    shipping_address.line1,
    shipping_address.line2,
    [shipping_address.city, shipping_address.province, shipping_address.postal_code].filter(Boolean).join(", "),
    shipping_address.country,
  ].filter(Boolean);

  const clientIp = getClientIp(req);
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: orderErr } = await db.from("orders").insert({
    id: orderId,
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
    payment_note: `Total charged: $${(totalCents / 100).toFixed(2)} (Bakeri service charge: $${(platformFeeCents / 100).toFixed(2)}, deducted from your payout)`,
    platform_fee_cents: platformFeeCents,
    deposit_amount: 0,
    deposit_note: "",
    fulfillment_type: "Shipping",
    delivery_details: addressLines.join("\n"),
    is_delivery: false,
    delivery_address: null,
    shipping_address,
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
    ...(settlement ?? {}),
  });

  if (orderErr) {
    console.error("orders insert failed:", orderErr.message);
    // Stock is already decremented and the charge already captured — unlike
    // the pre-decrement failure paths above, refunding here would leave
    // stock permanently short with no order to show for it. Record what we
    // can and surface the reference instead.
    return json({
      error: "Payment succeeded but we had trouble recording your order — contact the baker with this reference: " + payment_intent_id,
    }, 400);
  }

  const orderItemsPayload = items.map((item) => ({
    id: crypto.randomUUID(),
    user_id: bakerId,
    order_id: orderId,
    recipe_id: null,
    custom_name: item.name,
    quantity: qtyById.get(item.id as string) ?? 1,
    unit: item.unit || "item",
    price_per_unit: (priceCentsById.get(item.id) ?? 0) / 100,
    notes: "",
    updated_at: now,
  }));

  const { error: itemInsertErr } = await db.from("order_items").insert(orderItemsPayload);

  if (itemInsertErr) {
    console.error("order_items insert failed:", itemInsertErr.message);
    // Order already recorded and paid — don't fail the purchase over this.
  }

  // Sent from here directly (unlike finalize-guest-digital-order, which
  // hands signed download URLs back to the client to relay to a separate
  // email function) — there's no client-generated artifact to shuttle back
  // for a physical order, so there's nothing gained by a second round trip.
  // A failed send here never blocks the order — it's already paid and
  // recorded either way; the confirmation screen is the buyer's fallback.
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (resendApiKey) {
    const itemRows = orderItemsPayload
      .map((i) => `<tr><td style="padding:6px 0;">${i.quantity}× ${escapeHtml(i.custom_name)}</td><td style="padding:6px 0;text-align:right;">$${(i.price_per_unit * i.quantity).toFixed(2)}</td></tr>`)
      .join("");
    const shippingRow = shippingFeeCents > 0
      ? `<tr><td style="padding:6px 0;color:#6B5F54;">Shipping</td><td style="padding:6px 0;text-align:right;color:#6B5F54;">$${(shippingFeeCents / 100).toFixed(2)}</td></tr>`
      : "";
    const totalRow = `<tr><td style="padding:6px 0;font-weight:700;">Total</td><td style="padding:6px 0;text-align:right;font-weight:700;">$${(totalCents / 100).toFixed(2)}</td></tr>`;
    const addressHtml = addressLines.map((l) => escapeHtml(l)).join("<br/>");
    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
        <h2 style="margin:0 0 8px;">Your order will ship soon</h2>
        <p style="color:#6B5F54;line-height:1.5;">
          Thanks for your purchase from ${escapeHtml(bakerDisplayName)} — ${escapeHtml(orderName)} will ship to the address below.
        </p>
        <p style="line-height:1.6;margin-top:16px;">📦 ${addressHtml}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;border-top:1px solid #E8E4DC;padding-top:12px;">
          ${itemRows}${shippingRow}${totalRow}
        </table>
        <p style="color:#A89B8C;font-size:12px;margin-top:24px;">Order reference: ${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}</p>
      </div>
    `;
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({
          from: "Bakerï <hello@bakeriapp.com>",
          to: customer_email,
          subject: `Order confirmed — ${orderName}`,
          html,
        }),
      });
      if (!resendRes.ok) console.error("Resend send failed:", await resendRes.text());
    } catch (err) {
      console.error("Resend send threw:", err instanceof Error ? err.message : err);
    }
  }

  return json({
    order_id: orderId,
    baker_name: bakerDisplayName,
    items: orderItemsPayload.map((i) => ({ item_name: i.custom_name, quantity: i.quantity, price_per_unit: i.price_per_unit })),
    subtotal_cents: subtotalCents,
    shipping_fee_cents: shippingFeeCents,
    platform_fee_cents: platformFeeCents,
    total_cents: totalCents,
  });
});

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
