import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint for a baker's storefront (baker/index.html
// digital feed, baker/digital-checkout.html) — records a guest's already-paid
// digital purchase(s) and hands back signed download URLs in the same
// response, since a guest has no session to fetch them later.
//
// Unlike create-guest-marketplace-order (physical goods, pending-until-
// baker-accepts), a digital sale is "done" the moment payment succeeds —
// there's no pickup/handoff step, so this inserts the order straight into
// marketplace_status='completed' with completed_at=now(). That's the exact
// signal release-baker-payouts already watches for, so the existing
// 24h-dispute-then-sweep payout pipeline picks it up unchanged — no new
// payout logic needed for this listing kind.
//
// A digital cart can hold multiple items but is always single-baker (one
// storefront page) — see create-payment-intent's isDigital handling. One
// PaymentIntent covers the whole cart, so a failure past payment
// verification refunds the whole thing rather than attempting itemized
// partial refunds; create-payment-intent already re-validates every item
// before the charge happens, so that path should be rare.

import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement } from "../_shared/settlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days — plenty for a buyer to grab their download

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
  // menu_item_id (singular) kept for back-compat with any cached copy of the
  // storefront page still sending the old single-item shape.
  const menu_item_ids = Array.isArray(body.menu_item_ids)
    ? [...new Set(body.menu_item_ids.map((id) => String(id).trim()).filter(Boolean))]
    : [String(body.menu_item_id ?? "").trim()].filter(Boolean);
  const customer_name = String(body.customer_name ?? "").trim();
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();

  if (!payment_intent_id || menu_item_ids.length === 0) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Re-fetch every listing server-side — never trust client-supplied price/name.
  const { data: items, error: itemsErr } = await db
    .from("menu_items")
    .select("id, user_id, name, default_price, marketplace_price_from, listing_kind, is_listed_in_marketplace, digital_file_path")
    .in("id", menu_item_ids);

  // A missing/short result means at least one listing in the cart is gone —
  // we don't yet know which baker/connected account this belongs to (can't
  // even be sure every item shares one), so there's no account context to
  // scope a refund attempt to. Rare (create-payment-intent already rejects a
  // deleted/delisted item before charging); everything below this point does
  // know the account, so it refunds automatically on failure instead of
  // leaving the buyer charged with nothing to show for it.
  if (itemsErr || !items || items.length !== menu_item_ids.length) {
    return json({ error: "One of these items is no longer available." }, 400);
  }
  if (items.some((i) => i.listing_kind !== "digital")) {
    return json({ error: "One of these items is not a digital download." }, 400);
  }
  const bakerIds = new Set(items.map((i) => i.user_id));
  if (bakerIds.size !== 1) {
    return json({ error: "These items are from different bakers and can't be checked out together." }, 400);
  }

  const bakerId = items[0].user_id as string;

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, stripe_connect_account_id")
    .eq("id", bakerId)
    .single();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";
  const connectedAccountId = bakerProfile?.stripe_connect_account_id ?? null;

  // A digital cart is always single-baker, so the PaymentIntent
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

  // Past this point the charge is confirmed real (server-verified against
  // Stripe, not just trusted from the client). The buyer already paid the
  // baker, so the right outcome is to still deliver if at all possible —
  // is_listed_in_marketplace only gates whether a *new* purchase can start
  // (enforced in create-payment-intent, before the charge happens) and
  // shouldn't block fulfilling one that's already been paid for. Only a
  // genuinely undeliverable file (never attached, or storage can't sign it)
  // falls back to a refund, since there's nothing left to hand over.
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

  const missingFile = items.find((i) => !i.digital_file_path);
  if (missingFile) return refundAndFail(`"${missingFile.name}" has no file attached.`);

  const priceCentsById = new Map(
    items.map((i) => [
      i.id,
      Math.round(((i.marketplace_price_from ?? 0) > 0 ? i.marketplace_price_from : i.default_price) * 100),
    ])
  );
  const subtotalCents = [...priceCentsById.values()].reduce((sum, c) => sum + c, 0);
  // Guest checkout: buyer pays exactly the item price(s) — Bakeri's service
  // charge comes out of the baker's cut instead (see create-payment-intent).
  const platformFeeCents = Math.round(subtotalCents * PLATFORM_FEE_RATE);
  const totalCents = subtotalCents;

  // Already settled instantly if direct — record the real Stripe fee now so
  // this closes the payout loop immediately instead of waiting on
  // release-baker-payouts (whose sweep only runs for platform_custody orders).
  const settlement = connectedAccountId
    ? await readDirectChargeSettlement(stripe, payment_intent_id, connectedAccountId, platformFeeCents)
    : null;

  // One signed URL per item. If any fails, refund the whole cart rather than
  // partially deliver — keeps the refund-or-deliver contract all-or-nothing,
  // same as every other failure path here.
  const downloads: { item_name: string; download_url: string }[] = [];
  for (const item of items) {
    const { data: signedUrlData, error: signedUrlErr } = await db.storage
      .from("digital-products")
      .createSignedUrl(item.digital_file_path as string, SIGNED_URL_EXPIRY_SECONDS);

    if (signedUrlErr || !signedUrlData?.signedUrl) {
      console.error("createSignedUrl failed:", item.id, signedUrlErr?.message);
      return refundAndFail("We couldn't prepare your download.");
    }
    downloads.push({ item_name: item.name, download_url: signedUrlData.signedUrl });
  }

  // Order name: the single item's name, or "First item + N more" for a
  // cart — matches create-guest-marketplace-order's convention.
  const orderName = items.length === 1 ? items[0].name : `${items[0].name} + ${items.length - 1} more`;

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
    ...(settlement ?? {}),
  });

  if (orderErr) {
    console.error("orders insert failed:", orderErr.message);
    return refundAndFail("Something went wrong recording your order.");
  }

  const { error: itemInsertErr } = await db.from("order_items").insert(
    items.map((item) => ({
      id: crypto.randomUUID(),
      user_id: bakerId,
      order_id: orderId,
      recipe_id: null,
      custom_name: item.name,
      quantity: 1,
      unit: "download",
      price_per_unit: (priceCentsById.get(item.id) ?? 0) / 100,
      notes: "",
      updated_at: now,
    }))
  );

  if (itemInsertErr) {
    console.error("order_items insert failed:", itemInsertErr.message);
    // Order already recorded and paid — don't fail the purchase over this.
  }

  return json({
    order_id: orderId,
    baker_name: bakerDisplayName,
    downloads,
    subtotal_cents: subtotalCents,
    platform_fee_cents: platformFeeCents,
    total_cents: totalCents,
    expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS,
  });
});
