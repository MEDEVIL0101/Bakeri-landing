import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logNotification } from "../_shared/notificationLog.ts";

// Baker-triggered: "Mark as Shipped" in MarketplaceOrderSheet.swift, for a
// physical (fulfillment_type='Shipping') order sitting in
// marketplace_status='awaiting_shipment' (finalize-guest-physical-order
// inserts here now instead of 'completed' — see
// 20260822000005_shipping_tracking.sql). Records the carrier/tracking
// number, moves the order to 'completed' (terminal, same as digital), and
// owns the whole customer notification itself — same shape as
// mark-order-ready-for-pickup, which this is deliberately modeled on.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// A plain `fetch(...).catch(...)` doesn't catch a non-2xx response — see
// mark-order-ready-for-pickup's postWithRetry, which this copies verbatim
// (same failure mode would otherwise silently drop the shipped email).
async function postWithRetry(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  let lastError = "unknown error";
  const delaysMs = [0, 600, 1400, 2600];
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "x-webhook-secret": WEBHOOK_SECRET,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      lastError = (await res.text()).slice(0, 500);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json() as {
      order_id: string;
      carrier: string;
      tracking_number?: string;
    };
    const order_id = String(body.order_id ?? "").trim();
    const carrier = String(body.carrier ?? "").trim();
    const tracking_number = body.tracking_number ? String(body.tracking_number).trim() : null;
    if (!order_id) throw new Error("Missing order_id");
    if (!carrier) throw new Error("Missing carrier");

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, order_name, marketplace_status, buyer_profile_id, lead_channel, baker_display_name")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (order.user_id !== user.id) throw new Error("Forbidden");
    if (order.marketplace_status !== "awaiting_shipment") {
      throw new Error(`Cannot mark shipped from status: ${order.marketplace_status}`);
    }

    const shippedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        marketplace_status: "completed",
        tracking_number,
        shipping_carrier: carrier,
        shipped_at: shippedAt,
        completed_at: shippedAt,
        updated_at: shippedAt,
      })
      .eq("id", order_id);
    if (updateErr) throw new Error(updateErr.message);

    let notified = true;

    // Push (in-app buyer) — always null today (finalize-guest-physical-order
    // is guest-checkout only), kept for parity with mark-order-ready-for-pickup
    // in case an in-app physical-purchase flow is ever added.
    if (order.buyer_profile_id) {
      const result = await postWithRetry(`${SUPABASE_URL}/functions/v1/notify-marketplace`, {
        recipient_user_id: order.buyer_profile_id,
        title: "📦 Your order has shipped!",
        body: `${order.order_name || "Your order"} is on its way${carrier ? ` via ${carrier}` : ""}.`,
        data: { type: "order_shipped", order_id },
      });
      if (!result.ok) {
        console.error(`notify-marketplace push failed for order ${order_id}:`, result.error);
        notified = false;
        await logNotification(supabase, order_id, "order_shipped", "failed", result.error, "push");
      }
    }

    // Email (guest)
    if (!order.buyer_profile_id && order.lead_channel === "website") {
      const result = await postWithRetry(`${SUPABASE_URL}/functions/v1/send-guest-order-shipped-email`, {
        order_id,
      });
      if (!result.ok) {
        console.error(`send-guest-order-shipped-email failed for order ${order_id}:`, result.error);
        notified = false;
        await logNotification(supabase, order_id, "guest_order_shipped", "failed", result.error, "email");
      }
    }

    // The order update above already succeeded and stands regardless —
    // `notified: false` just tells the baker the customer may not know yet.
    return json({ ok: true, notified });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 400);
  }
});
