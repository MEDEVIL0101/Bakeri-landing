import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement, toDepositSettlementFields } from "../_shared/settlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

// This function only ever runs for in-app (authenticated) orders — the guest
// storefront cart uses create-guest-marketplace-order instead. As of
// 2026-08-02, app orders charge the service fee on both sides: the charge
// create-payment-intent made already added one 5% cut on top of what the
// buyer's cart totaled, AND application_fee_amount on that same charge took
// a *second* 5% cut out of the baker's own base price — so the
// platform_fee_cents recorded here (each order's fair share, proportional to
// its own item subtotal) is doubled to match the actual total taken, not
// just the nominal rate. Read back verbatim by release-baker-payouts for
// platform_custody (multi-baker) carts, or by capture-payment/
// readDirectChargeSettlement for a single-baker cart.

interface FormResponseAnswer {
  fieldID: string;
  label: string;
  fieldType: string;
  textValue?: string | null;
  choiceValues?: string[] | null;
  photoPaths?: string[] | null;
}

interface CartItemPayload {
  listing_id: string;
  baker_id: string;
  name: string;
  quantity: number;
  price_from: number;
  listing_kind: "ready_now" | "preorder" | "custom";
  scheduled_pickup?: string | null;
  notes?: string;
  form_responses?: FormResponseAnswer[] | null;
  wants_delivery?: boolean;
  delivery_fee?: number;
  delivery_address?: string | null;
}

interface RequestBody {
  payment_intent_id?: string;
  setup_intent_id?: string;
  buyer_display_name: string;
  items: CartItemPayload[];
  payment_flow?: "auth_hold" | "setup_intent" | "deposit_and_save";
  deposit_amount_cents?: number | null;
  scheduled_hold_at?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const {
      payment_intent_id,
      setup_intent_id,
      items,
      payment_flow = "auth_hold",
      deposit_amount_cents = null,
      scheduled_hold_at = null,
    }: RequestBody = await req.json();

    // Authoritative per-item price — never trust the client's price_from.
    // create-payment-intent already re-prices ready_now/preorder/custom
    // items server-side before the Stripe hold is created; re-fetching here
    // too means the order/order_items rows this function writes (platform
    // fee calc, price_per_unit shown to the baker) can't end up recording a
    // different, fabricated number than what was actually authorized. Falls
    // back to the client's price_from only if the listing can no longer be
    // found — the payment already succeeded by this point, so a hard
    // failure here would leave a captured/held charge with no order.
    const { data: listingRows } = await supabase
      .from("menu_items")
      .select("id, default_price, marketplace_price_from")
      .in("id", items.map((i) => i.listing_id));
    const authoritativePriceByListingId = new Map<string, number>(
      (listingRows ?? []).map((l) => [
        l.id,
        ((l.marketplace_price_from ?? 0) > 0 ? l.marketplace_price_from : l.default_price) ?? 0,
      ])
    );
    const priceForItem = (item: CartItemPayload) =>
      authoritativePriceByListingId.get(item.listing_id) ?? item.price_from;

    // Look up buyer's display name from their profile — don't trust client payload
    const { data: buyerProfile } = await supabase
      .from("profiles")
      .select("community_handle, user_name")
      .eq("id", user.id)
      .single();
    const handle = buyerProfile?.community_handle?.trim();
    const uname  = buyerProfile?.user_name?.trim();
    const buyer_display_name = handle ? `@${handle}` : uname || user.email || "Bakeri customer";

    // A cart spanning exactly one baker was charged as a Stripe Connect
    // direct charge on that baker's own connected account
    // (create-payment-intent) — verification must target the same account.
    // A multi-baker cart stays on the unchanged platform-custody model
    // (dormant today — unreachable while the cross-baker marketplace is
    // paused), verified against the platform account as before.
    const distinctBakerIds = [...new Set(items.map((i) => i.baker_id))];
    const isSingleBaker = distinctBakerIds.length === 1;
    let connectedAccountId: string | null = null;
    if (isSingleBaker) {
      const { data: connectRow } = await supabase
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", distinctBakerIds[0])
        .single();
      connectedAccountId = connectRow?.stripe_connect_account_id ?? null;
    }
    // setup_intent flow has no charge at all yet (a card is only saved, not
    // charged — the deferred hold placement described in create-setup-intent
    // isn't implemented), so there's no real charge to label 'direct' yet.
    const paymentModel: "direct" | "platform_custody" =
      connectedAccountId && payment_flow !== "setup_intent" ? "direct" : "platform_custody";

    // Verify payment with Stripe — skip for mock IDs and setup_intent flow
    const isMock = payment_intent_id?.startsWith("mock_") || setup_intent_id?.startsWith("mock_");
    if (!isMock) {
      if (payment_flow === "setup_intent" && setup_intent_id) {
        // SetupIntents never carry Connect params today (no charge happens at
        // this step), so no stripeAccount option here regardless of baker count.
        try {
          const intent = await stripe.setupIntents.retrieve(setup_intent_id);
          if (intent.status !== "succeeded") {
            throw new Error(`Setup intent not confirmed. Status: ${intent.status}`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Setup intent not confirmed")) throw err;
          // Stripe lookup failed for another reason — matches prior behavior
          // of silently proceeding rather than blocking order creation on a
          // transient verification-fetch failure.
        }
      } else if (payment_intent_id) {
        try {
          const intent = connectedAccountId
            ? await stripe.paymentIntents.retrieve(payment_intent_id, { stripeAccount: connectedAccountId })
            : await stripe.paymentIntents.retrieve(payment_intent_id);
          if (intent.status !== "succeeded" && intent.status !== "requires_capture") {
            throw new Error(`Payment not confirmed. Status: ${intent.status}`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Payment not confirmed")) throw err;
          // Same non-blocking-on-transient-failure behavior as before.
        }
      }
    }

    // Determine initial payment_status per flow
    const paymentStatus = payment_flow === "setup_intent"
      ? "pending"
      : payment_flow === "deposit_and_save"
      ? "deposit_paid"
      : "authorized";

    // deposit_and_save charges capture immediately (create-payment-intent
    // uses capture_method: "automatic" for it), so for a direct charge the
    // settlement is already available — read it once and close the payout
    // loop right away instead of waiting on release-baker-payouts.
    let depositSettlement: Record<string, unknown> | null = null;
    if (paymentModel === "direct" && payment_flow === "deposit_and_save" && payment_intent_id && connectedAccountId) {
      // ×2 — matches the doubled application_fee_amount create-payment-intent
      // actually took for this app order (see module header comment).
      const settlement = await readDirectChargeSettlement(
        stripe,
        payment_intent_id,
        connectedAccountId,
        Math.round((deposit_amount_cents ?? 0) * PLATFORM_FEE_RATE) * 2
      );
      depositSettlement = settlement ? toDepositSettlementFields(settlement) : null;
    }

    // Group items by baker AND listing kind so ready-now orders are always separate
    // from preorders — they need different urgency handling by the baker.
    const byBakerAndKind = new Map<string, { bakerID: string; kind: string; items: CartItemPayload[] }>();
    for (const item of items) {
      const key = `${item.baker_id}:${item.listing_kind}`;
      const group = byBakerAndKind.get(key) ?? { bakerID: item.baker_id, kind: item.listing_kind, items: [] };
      group.items.push(item);
      byBakerAndKind.set(key, group);
    }

    // Cache baker profiles so we only look each one up once across all groups
    const bakerProfileCache = new Map<string, string>();

    const createdOrderIDs: string[] = [];
    const now = new Date().toISOString();

    for (const [, group] of byBakerAndKind.entries()) {
      const { bakerID, kind, items: groupItems } = group;
      const orderID = crypto.randomUUID();
      const firstPickup = groupItems.find((i) => i.scheduled_pickup)?.scheduled_pickup ?? null;
      const notesArray = groupItems
        .filter((i) => i.notes?.trim())
        .map((i) => `${i.name}: ${i.notes}`)
        .join("; ");

      // One baker per group, so delivery is effectively an all-or-nothing choice
      // for this order — take it from whichever item(s) requested it.
      const groupWantsDelivery = groupItems.some((i) => i.wants_delivery === true);
      const groupDeliveryAddress = groupItems.find((i) => i.wants_delivery && i.delivery_address)?.delivery_address ?? null;

      const itemNames = groupItems.map((i) => i.name);
      const orderName = itemNames.length === 1
        ? itemNames[0]
        : itemNames.length === 2
        ? itemNames.join(" & ")
        : `${itemNames[0]} + ${itemNames.length - 1} more`;

      // Fetch baker profile once per baker, reuse for multiple kind-groups
      if (!bakerProfileCache.has(bakerID)) {
        const { data: bakerProfile } = await supabase
          .from("profiles")
          .select("business_name, user_name")
          .eq("id", bakerID)
          .single();
        const name = bakerProfile?.business_name?.trim() ||
          bakerProfile?.user_name?.trim() || "Baker";
        bakerProfileCache.set(bakerID, name);
      }
      const bakerDisplayName = bakerProfileCache.get(bakerID)!;

      // ready_now orders have no scheduled pickup and need immediate baker action
      const dueDate = kind === "ready_now"
        ? new Date(Date.now() + 86400000).toISOString()   // tomorrow — urgent
        : firstPickup ?? new Date(Date.now() + 86400000).toISOString();

      // This group's fair share of the fee already baked into the charge —
      // for deposit_and_save the whole charge *is* the deposit (one group in
      // practice, since "custom" listings go through their own request/quote
      // flow rather than sharing a cart with other kinds), so it gets the
      // full deposit fee rather than a per-item split.
      const groupSubtotalCents = Math.round(
        groupItems.reduce((sum, i) => sum + priceForItem(i) * i.quantity, 0) * 100
      );
      // ×2 — see module header comment: an app order's application_fee_amount
      // takes this fee twice (once from the customer's added charge, once
      // from the baker's own base), so the stored figure must match.
      const groupPlatformFeeCents = (payment_flow === "deposit_and_save"
        ? Math.round((deposit_amount_cents ?? 0) * PLATFORM_FEE_RATE)
        : Math.round(groupSubtotalCents * PLATFORM_FEE_RATE)) * 2;

      const { error: orderErr } = await supabase.from("orders").insert({
        id: orderID,
        user_id: bakerID,
        order_name: orderName,
        baker_display_name: bakerDisplayName,
        customer_name: buyer_display_name,
        customer_phone: "",
        customer_email: "",
        due_date: dueDate,
        status: "Confirmed",
        notes: notesArray,
        is_paid: false,
        payment_note: "",
        deposit_amount: 0,
        deposit_note: "",
        fulfillment_type: groupWantsDelivery ? "Delivery" : "Pickup",
        delivery_details: "",
        is_delivery: groupWantsDelivery,
        delivery_address: groupDeliveryAddress,
        created_at: now,
        updated_at: now,
        color_name: kind === "ready_now" ? "red" : "blue",
        order_source: "marketplace",
        marketplace_status: "pending",
        buyer_profile_id: user.id,
        buyer_display_name,
        scheduled_pickup_date: kind === "ready_now" ? null : firstPickup,
        payment_intent_id: payment_intent_id ?? null,
        payment_status: paymentStatus,
        payment_model: paymentModel,
        reference_photo_count: 0,
        payment_flow,
        setup_intent_id: setup_intent_id ?? null,
        deposit_amount_cents: deposit_amount_cents ?? null,
        scheduled_hold_at: scheduled_hold_at ?? null,
        platform_fee_cents: payment_flow === "deposit_and_save" ? null : groupPlatformFeeCents,
        deposit_payment_intent_id: payment_flow === "deposit_and_save" ? (payment_intent_id ?? null) : null,
        deposit_charged_at: payment_flow === "deposit_and_save" ? now : null,
        deposit_platform_fee_cents: payment_flow === "deposit_and_save" ? groupPlatformFeeCents : null,
        ...(payment_flow === "deposit_and_save" ? depositSettlement ?? {} : {}),
      });

      if (orderErr) throw new Error(`Failed to create order: ${orderErr.message}`);

      const orderItemRows = groupItems.map((item) => ({
        id: crypto.randomUUID(),
        user_id: bakerID,
        order_id: orderID,
        recipe_id: null,
        custom_name: item.name,
        quantity: item.quantity,
        unit: "pieces",
        price_per_unit: priceForItem(item),
        notes: item.notes ?? "",
        form_responses: item.form_responses && item.form_responses.length > 0 ? item.form_responses : null,
        wants_delivery: item.wants_delivery ?? false,
        updated_at: now,
      }));

      const { error: itemErr } = await supabase.from("order_items").insert(orderItemRows);
      if (itemErr) throw new Error(`Failed to create order items: ${itemErr.message}`);

      createdOrderIDs.push(orderID);
    }

    return new Response(
      JSON.stringify({ order_ids: createdOrderIDs }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
