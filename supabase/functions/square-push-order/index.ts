// square-push-order
// Pushes a Bakeri order to the baker's connected Square POS.
// Called from the iOS app (baker's client) when a new order arrives.
//
// POST body: { "order_id": "UUID" }
// Auth: Bearer {baker's Supabase JWT}
//
// Required env vars:
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   SUPABASE_ANON_KEY         — auto-injected (used for JWT verification)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SQUARE_API       = "https://connect.squareup.com";
const SQUARE_VERSION   = "2024-01-17";
const CURRENCY         = "CAD";

interface OrderItem {
  id: string;
  custom_name: string | null;
  quantity: number | null;
  unit: string | null;
  price_per_unit: number | null;
  notes: string | null;
}

interface Order {
  id: string;
  order_name: string;
  customer_name: string | null;
  due_date: string | null;
  fulfillment_type: string | null;
  notes: string | null;
  order_items: OrderItem[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  // ── 1. Verify baker JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) {
    return new Response(JSON.stringify({ error: "order_id required" }), { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  // ── 2. Fetch order (baker must own it) ───────────────────────────────────────
  const { data: order } = await admin
    .from("orders")
    .select("id,order_name,customer_name,due_date,fulfillment_type,notes,order_items(id,custom_name,quantity,unit,price_per_unit,notes)")
    .eq("id", order_id)
    .eq("user_id", user.id)
    .single<Order>();

  if (!order) {
    return new Response(JSON.stringify({ error: "Order not found or not yours" }), { status: 404 });
  }

  // ── 3. Fetch Square integration ───────────────────────────────────────────────
  const { data: pos } = await admin
    .from("pos_integrations")
    .select("access_token,location_id")
    .eq("user_id", user.id)
    .eq("pos_type", "square")
    .eq("is_active", true)
    .single<{ access_token: string; location_id: string }>();

  if (!pos) {
    return new Response(JSON.stringify({ error: "No active Square integration" }), { status: 404 });
  }

  // ── 4. Build Square order payload ─────────────────────────────────────────────
  const lineItems = (order.order_items ?? []).map((item) => ({
    name:             item.custom_name ?? "Item",
    quantity:         String(item.quantity ?? 1),
    base_price_money: {
      amount:   Math.round((item.price_per_unit ?? 0) * 100), // dollars → cents
      currency: CURRENCY,
    },
    ...(item.notes ? { note: item.notes } : {}),
  }));

  // If no line items, create a placeholder so Square accepts the order
  if (lineItems.length === 0) {
    lineItems.push({ name: order.order_name, quantity: "1", base_price_money: { amount: 0, currency: CURRENCY } });
  }

  const squareOrder: Record<string, unknown> = {
    location_id: pos.location_id,
    reference_id: order.id,
    line_items:  lineItems,
    ...(order.customer_name ? { customer_note: `Customer: ${order.customer_name}` } : {}),
    ...(order.notes ? { note: order.notes } : {}),
  };

  // Add pickup fulfillment if we have a due date
  if (order.due_date) {
    squareOrder.fulfillments = [{
      type:  "PICKUP",
      state: "PROPOSED",
      pickup_details: {
        recipient:  { display_name: order.customer_name ?? "Customer" },
        pickup_at:  order.due_date,
        note:       order.fulfillment_type ?? "Pickup",
      },
    }];
  }

  // ── 5. POST to Square Orders API ─────────────────────────────────────────────
  const squareRes = await fetch(`${SQUARE_API}/v2/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pos.access_token}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify({ order: squareOrder, idempotency_key: order.id }),
  });

  const squareData = await squareRes.json();
  const posOrderId = squareData.order?.id ?? null;
  const success    = squareRes.ok;

  // ── 6. Log result ─────────────────────────────────────────────────────────────
  await admin.from("pos_sync_log").insert({
    user_id:       user.id,
    pos_type:      "square",
    direction:     "push_order",
    bakeri_id:     order.id,
    pos_id:        posOrderId,
    status:        success ? "success" : "failed",
    error_message: success ? null : JSON.stringify(squareData.errors ?? squareData),
  });

  if (!success) {
    console.error("Square order push failed:", squareData);
    return new Response(JSON.stringify({ error: "Square API error", detail: squareData }), { status: 502 });
  }

  return new Response(JSON.stringify({ success: true, pos_order_id: posOrderId }), {
    headers: { "Content-Type": "application/json" },
  });
});
