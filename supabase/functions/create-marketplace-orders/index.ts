import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Must match create-payment-intent's PLATFORM_FEE_RATE — the charge already
// created there added this fee on top of what the buyer's cart totaled, so
// here we just record each order's fair share of that fee (proportional to
// its own item subtotal) for release-baker-payouts to read back verbatim.
const PLATFORM_FEE_RATE = 0.05;

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

    // Look up buyer's display name from their profile — don't trust client payload
    const { data: buyerProfile } = await supabase
      .from("profiles")
      .select("community_handle, user_name")
      .eq("id", user.id)
      .single();
    const handle = buyerProfile?.community_handle?.trim();
    const uname  = buyerProfile?.user_name?.trim();
    const buyer_display_name = handle ? `@${handle}` : uname || user.email || "Bakeri customer";

    // Verify payment with Stripe — skip for mock IDs and setup_intent flow
    const isMock = payment_intent_id?.startsWith("mock_") || setup_intent_id?.startsWith("mock_");
    if (!isMock && STRIPE_SECRET_KEY) {
      if (payment_flow === "setup_intent" && setup_intent_id) {
        const stripeRes = await fetch(
          `https://api.stripe.com/v1/setup_intents/${setup_intent_id}`,
          { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
        );
        if (stripeRes.ok) {
          const intent = await stripeRes.json();
          if (intent.status !== "succeeded") {
            throw new Error(`Setup intent not confirmed. Status: ${intent.status}`);
          }
        }
      } else if (payment_intent_id) {
        const stripeRes = await fetch(
          `https://api.stripe.com/v1/payment_intents/${payment_intent_id}`,
          { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
        );
        if (stripeRes.ok) {
          const intent = await stripeRes.json();
          if (intent.status !== "succeeded" && intent.status !== "requires_capture") {
            throw new Error(`Payment not confirmed. Status: ${intent.status}`);
          }
        }
      }
    }

    // Determine initial payment_status per flow
    const paymentStatus = payment_flow === "setup_intent"
      ? "pending"
      : payment_flow === "deposit_and_save"
      ? "deposit_paid"
      : "authorized";

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
        groupItems.reduce((sum, i) => sum + i.price_from * i.quantity, 0) * 100
      );
      const groupPlatformFeeCents = payment_flow === "deposit_and_save"
        ? Math.round((deposit_amount_cents ?? 0) * PLATFORM_FEE_RATE)
        : Math.round(groupSubtotalCents * PLATFORM_FEE_RATE);

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
        reference_photo_count: 0,
        payment_flow,
        setup_intent_id: setup_intent_id ?? null,
        deposit_amount_cents: deposit_amount_cents ?? null,
        scheduled_hold_at: scheduled_hold_at ?? null,
        platform_fee_cents: payment_flow === "deposit_and_save" ? null : groupPlatformFeeCents,
        deposit_payment_intent_id: payment_flow === "deposit_and_save" ? (payment_intent_id ?? null) : null,
        deposit_charged_at: payment_flow === "deposit_and_save" ? now : null,
        deposit_platform_fee_cents: payment_flow === "deposit_and_save" ? groupPlatformFeeCents : null,
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
        price_per_unit: item.price_from,
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
