import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint for a baker's storefront (baker/index.html)
// digital-item purchase sheet — records a guest's already-paid digital
// purchase and hands back a signed download URL in the same response, since
// a guest has no session to fetch it later.
//
// Unlike create-guest-marketplace-order (physical goods, pending-until-
// baker-accepts), a digital sale is "done" the moment payment succeeds —
// there's no pickup/handoff step, so this inserts the order straight into
// marketplace_status='completed' with completed_at=now(). That's the exact
// signal release-baker-payouts already watches for, so the existing
// 24h-dispute-then-sweep payout pipeline picks it up unchanged — no new
// payout logic needed for this listing kind.
//
// Digital purchases are always solo (one item, no cart) — see
// create-payment-intent's isDigital capture_method handling and
// create-guest-marketplace-order's rejection of listing_kind='digital'.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Must match create-payment-intent's PLATFORM_FEE_RATE.
const PLATFORM_FEE_RATE = 0.05;
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
  const menu_item_id = String(body.menu_item_id ?? "").trim();
  const customer_name = String(body.customer_name ?? "").trim();
  const customer_email = String(body.customer_email ?? "").trim().toLowerCase();

  if (!payment_intent_id || !menu_item_id) return json({ error: "Invalid request." }, 400);
  if (!customer_name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(customer_email)) return json({ error: "Please enter a valid email address." }, 400);

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
  const { data: item, error: itemErr } = await db
    .from("menu_items")
    .select("id, user_id, name, default_price, marketplace_price_from, listing_kind, is_listed_in_marketplace, digital_file_path")
    .eq("id", menu_item_id)
    .single();

  if (itemErr || !item) return json({ error: "This item is no longer available." }, 400);
  if (item.listing_kind !== "digital") return json({ error: "This item is not a digital download." }, 400);
  if (!item.is_listed_in_marketplace) return json({ error: `"${item.name}" is no longer available.` }, 400);
  if (!item.digital_file_path) return json({ error: "This item has no file attached yet — contact the baker." }, 400);

  const bakerId = item.user_id as string;

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name")
    .eq("id", bakerId)
    .single();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";

  const priceCents = Math.round(
    ((item.marketplace_price_from ?? 0) > 0 ? item.marketplace_price_from : item.default_price) * 100
  );
  const platformFeeCents = Math.round(priceCents * PLATFORM_FEE_RATE);
  const totalCents = priceCents + platformFeeCents;

  const { data: signedUrlData, error: signedUrlErr } = await db.storage
    .from("digital-products")
    .createSignedUrl(item.digital_file_path, SIGNED_URL_EXPIRY_SECONDS);

  if (signedUrlErr || !signedUrlData?.signedUrl) {
    console.error("createSignedUrl failed:", signedUrlErr?.message);
    return json({ error: "Payment succeeded but we couldn't prepare your download — contact the baker with this reference: " + payment_intent_id }, 400);
  }

  const clientIp = getClientIp(req);
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: orderErr } = await db.from("orders").insert({
    id: orderId,
    user_id: bakerId,
    order_name: item.name,
    baker_display_name: bakerDisplayName,
    customer_name,
    customer_phone: "",
    customer_email,
    due_date: now,
    status: "Confirmed",
    notes: "",
    is_paid: true,
    payment_note: `Subtotal: $${(priceCents / 100).toFixed(2)}, Bakeri fee: $${(platformFeeCents / 100).toFixed(2)}, Total: $${(totalCents / 100).toFixed(2)}`,
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
    reference_photo_count: 0,
    lead_channel: "website",
    ip_address: clientIp,
  });

  if (orderErr) {
    console.error("orders insert failed:", orderErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  const { error: itemInsertErr } = await db.from("order_items").insert({
    id: crypto.randomUUID(),
    user_id: bakerId,
    order_id: orderId,
    recipe_id: null,
    custom_name: item.name,
    quantity: 1,
    unit: "download",
    price_per_unit: priceCents / 100,
    notes: "",
    updated_at: now,
  });

  if (itemInsertErr) {
    console.error("order_items insert failed:", itemInsertErr.message);
    // Order already recorded and paid — don't fail the purchase over this.
  }

  return json({
    order_id: orderId,
    item_name: item.name,
    subtotal_cents: priceCents,
    platform_fee_cents: platformFeeCents,
    total_cents: totalCents,
    baker_name: bakerDisplayName,
    download_url: signedUrlData.signedUrl,
    expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS,
  });
});
