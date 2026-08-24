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
import { sendBakerOrderEmail } from "../_shared/bakerOrderEmail.ts";
import { resolveBakerEmail } from "../_shared/bakerEmail.ts";
import { logNotification } from "../_shared/notificationLog.ts";

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
  // storefront page still sending the old single-item shape. The richer
  // `items` shape (each with its own optional variant_id) is preferred when
  // present — same reasoning as finalize-guest-physical-order's requestedItems:
  // one requested line per cart line, NOT deduped by menu_item_id, since a
  // has_variants listing can appear more than once with a different option
  // picked (one shared digital file, but each option still needs its own
  // variant_id/variant_label recorded on its order_items row).
  const requestedLines: { menu_item_id: string; variant_id: string | null }[] = Array.isArray(body.items)
    ? (body.items as Record<string, unknown>[])
        .map((i) => ({ menu_item_id: String(i.id ?? "").trim(), variant_id: i.variant_id ? String(i.variant_id).trim() : null }))
        .filter((i) => i.menu_item_id)
    : (Array.isArray(body.menu_item_ids)
        ? [...new Set(body.menu_item_ids.map((id) => String(id).trim()).filter(Boolean))]
        : [String(body.menu_item_id ?? "").trim()].filter(Boolean)
      ).map((id) => ({ menu_item_id: id, variant_id: null }));
  const customer_name = String(body.customer_name ?? "").trim();
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();

  if (!payment_intent_id || requestedLines.length === 0) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const menu_item_ids = [...new Set(requestedLines.map((l) => l.menu_item_id))];

  // Re-fetch every listing server-side — never trust client-supplied price/name.
  const { data: menuItemRows, error: itemsErr } = await db
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
  if (itemsErr || !menuItemRows || menuItemRows.length !== menu_item_ids.length) {
    return json({ error: "One of these items is no longer available." }, 400);
  }
  if (menuItemRows.some((i) => i.listing_kind !== "digital")) {
    return json({ error: "One of these items is not a digital download." }, 400);
  }
  const bakerIds = new Set(menuItemRows.map((i) => i.user_id));
  if (bakerIds.size !== 1) {
    return json({ error: "These items are from different bakers and can't be checked out together." }, 400);
  }

  const bakerId = menuItemRows[0].user_id as string;
  const itemsById = new Map(menuItemRows.map((i) => [i.id as string, i]));

  const variantMenuItemIds = [...new Set(requestedLines.filter((l) => l.variant_id).map((l) => l.menu_item_id))];
  const { data: variantRows } = variantMenuItemIds.length
    ? await db.from("listing_variants").select("id, menu_item_id, label, price").in("menu_item_id", variantMenuItemIds).is("deleted_at", null)
    : { data: [] as { id: string; menu_item_id: string; label: string; price: number }[] };
  const variantsById = new Map((variantRows ?? []).map((v) => [v.id, v]));

  // One resolved line per requested line — never trust client price for a
  // variant pick, same reasoning as finalize-guest-physical-order.
  interface DigitalLine { menuItemId: string; name: string; variantId: string | null; variantLabel: string | null; unitPriceCents: number; digitalFilePath: string | null; }
  const digitalLines: DigitalLine[] = [];
  for (const req of requestedLines) {
    const menuItem = itemsById.get(req.menu_item_id);
    if (!menuItem) return json({ error: "One of these items is no longer available." }, 400);
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

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, email, stripe_connect_account_id")
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

  const missingFile = digitalLines.find((l) => !l.digitalFilePath);
  if (missingFile) return refundAndFail(`"${missingFile.name}" has no file attached.`);

  const subtotalCents = digitalLines.reduce((sum, l) => sum + l.unitPriceCents, 0);
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

  // One signed URL per distinct FILE, not per line — a has_variants digital
  // listing shares one uploaded file across every size/option (confirmed
  // scope: "one digital print file makes more sense"), so buying two
  // different sizes of the same listing should hand back one download link,
  // not the same file twice under two different labels. If any fails,
  // refund the whole cart rather than partially deliver — keeps the
  // refund-or-deliver contract all-or-nothing, same as every other failure
  // path here.
  const uniqueFileLines = [...new Map(digitalLines.map((l) => [l.digitalFilePath, l])).values()];
  const downloads: { item_name: string; download_url: string }[] = [];
  for (const line of uniqueFileLines) {
    const { data: signedUrlData, error: signedUrlErr } = await db.storage
      .from("digital-products")
      .createSignedUrl(line.digitalFilePath as string, SIGNED_URL_EXPIRY_SECONDS);

    if (signedUrlErr || !signedUrlData?.signedUrl) {
      console.error("createSignedUrl failed:", line.menuItemId, signedUrlErr?.message);
      return refundAndFail("We couldn't prepare your download.");
    }
    downloads.push({ item_name: itemsById.get(line.menuItemId)?.name ?? line.name, download_url: signedUrlData.signedUrl });
  }

  // Order name: the single item's name, or "First item + N more" for a
  // cart — matches create-guest-marketplace-order's convention.
  const orderName = digitalLines.length === 1 ? digitalLines[0].name : `${digitalLines[0].name} + ${digitalLines.length - 1} more`;

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
    digitalLines.map((line) => ({
      id: crypto.randomUUID(),
      user_id: bakerId,
      order_id: orderId,
      recipe_id: null,
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

  if (itemInsertErr) {
    console.error("order_items insert failed:", itemInsertErr.message);
    // Order already recorded and paid — don't fail the purchase over this.
  }

  // Best-effort, never blocks the response — this is a completed, already-
  // paid sale with no baker-accept step, so it's the baker's only
  // notification of the sale (same reasoning as finalize-guest-physical-order).
  const bakerEmail = await resolveBakerEmail(db, bakerId, bakerProfile?.email);
  if (bakerEmail) {
    const result = await sendBakerOrderEmail({
      db,
      bakerId,
      bakerEmail,
      items: digitalLines.map((line) => ({
        custom_name: line.name,
        quantity: 1,
        price_per_unit: line.unitPriceCents / 100,
        menu_item_id: line.menuItemId,
      })),
      customerName: customer_name,
      customerEmail: customer_email,
      totalCents,
      kind: "sale",
    });
    await logNotification(db, orderId, "baker_sale_email", result.ok ? "sent" : "failed", result.error);
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
