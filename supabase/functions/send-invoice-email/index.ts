import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { INVOICE_EMAIL_TEMPLATE } from "./template.ts";

// Baker-triggered: "Email Invoice" button on OrderDetailView. Requires the
// caller's own session and confirms they own the order before sending —
// unlike the web guest-payment functions, this one always has a real baker
// JWT behind it.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    const { order_id }: { order_id: string } = await req.json();
    if (!order_id) throw new Error("Missing order_id");

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, customer_name, customer_email, invoice_code, due_date, invoice_type, deposit_amount_cents, quoted_price")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("not_found");
    if (order.user_id !== user.id) throw new Error("forbidden");
    if (!order.invoice_code) throw new Error("generate_invoice_first");
    const customerEmail = (order.customer_email ?? "").trim();
    if (!customerEmail) throw new Error("no_email_on_file");

    const { data: items } = await supabase
      .from("order_items")
      .select("custom_name, quantity, price_per_unit, variant_breakdown")
      .eq("order_id", order.id)
      .is("deleted_at", null);
    const itemsTotal = (items ?? []).reduce(
      (sum: number, i: { quantity: number; price_per_unit: number }) => sum + i.quantity * i.price_per_unit,
      0
    );

    // The amount stated in the email must match what this specific invoice
    // actually charges — a deposit or balance invoice covers only part of
    // the total. Same math (including the quoted_price-over-order_items
    // fallback for a custom/marketplace quote) as create-invoice-payment-intent —
    // otherwise this email can state a stale "from" price instead of what the
    // baker actually quoted.
    const invoiceType = order.invoice_type ?? "full";
    const depositAmount = (order.deposit_amount_cents ?? 0) / 100;
    const quotedPrice = Number(order.quoted_price ?? 0);
    const effectiveTotal = quotedPrice > 0 ? quotedPrice : itemsTotal;
    if (effectiveTotal <= 0) throw new Error("no_amount_due");
    const total = invoiceType === "deposit" ? depositAmount
      : invoiceType === "balance" ? Math.max(effectiveTotal - depositAmount, 0)
      : effectiveTotal;
    if (total <= 0) throw new Error("no_amount_due");

    // Customer-facing item list — deliberately not order_name, which is a
    // baker-internal label that may not be meant for the customer to see.
    const itemsList = (items ?? [])
      .map((i: { custom_name: string; quantity: number; variant_breakdown: unknown }) => {
        const breakdown = Array.isArray(i.variant_breakdown)
          ? (i.variant_breakdown as { name: string; quantity: number }[])
              .map((v) => `${v.quantity}× ${escapeHtml(v.name)}`).join(", ")
          : "";
        return `${i.quantity}× ${escapeHtml(i.custom_name)}` + (breakdown ? ` <span style="color:#A89B8C;font-size:12px;">(${breakdown})</span>` : "");
      })
      .join("<br>");

    const { data: baker } = await supabase
      .from("profiles")
      .select("business_name, user_name")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Your baker";

    const payUrl = `https://bakeriapp.com/pay/?code=${encodeURIComponent(order.invoice_code)}`;
    const amount = `$${total.toFixed(2)}`;
    const firstName = (order.customer_name ?? "").trim().split(/\s+/)[0] || "";
    const customerGreeting = firstName ? `, ${escapeHtml(firstName)}` : "";
    const dueDateLine = order.due_date
      ? `<p>Due ${escapeHtml(new Date(order.due_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</p>`
      : "";

    const html = INVOICE_EMAIL_TEMPLATE
      .replace(/\{\{baker_name\}\}/g, escapeHtml(bakerName))
      .replace(/\{\{customer_greeting\}\}/g, customerGreeting)
      .replace(/\{\{amount\}\}/g, amount)
      .replace(/\{\{items_list\}\}/g, itemsList || "—")
      .replace(/\{\{due_date_line\}\}/g, dueDateLine)
      .replace(/\{\{pay_url\}\}/g, payUrl);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Bakerï <hello@bakeriapp.com>",
        to: customerEmail,
        subject: `Invoice from ${bakerName} — ${amount}`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Resend send failed for ${customerEmail}: ${res.status} ${errText}`);
      throw new Error("send_failed");
    }

    return new Response(JSON.stringify({ sent: true, email: customerEmail }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
