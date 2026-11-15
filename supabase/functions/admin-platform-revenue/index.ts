import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// admin-platform-revenue (Harvey 2026-11-04): Bakerï's ACTUAL revenue, read
// straight from the platform Stripe account's balance transactions — not an
// estimate from order totals. Bakerï earns money two ways:
//   • application fees on storefront payments (direct charges on vendors'
//     Connect accounts) — `application_fee` / `application_fee_refund`
//   • plan subscriptions billed on the platform account — `charge`/`payment`
//     and their refunds
// Costs reported alongside: Stripe's own fees (Connect account billing, Radar,
// payout fees, processing fees on platform charges) and referral payouts
// (transfers to referring vendors).
//
// Service-role only: deployed WITH JWT verification, then requires the token's
// role to be service_role (Bakeri Admin). Platform financials — never public.
//
// Body: { from?: ISO date, to?: ISO date, tz?: IANA zone for daily buckets,
//         detail?: "fees" | "subscriptions" | "revenue" | "costs" | "payouts" | "all_costs" | "net" }
// With `detail`, the response also has `lines`: one row per Stripe transaction
// in that category (Admin drill-downs, 2026-11-15), matched to the vendor it
// came from where Stripe says (connected account, or plan customer).
// Amounts are in the platform's settlement currency, in major units.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Line = { id: string; user_id: string | null; title: string; subtitle: string; value: number; at: string;
              account?: string | null; customer?: string | null };

async function lookup(table: string, col: string, ids: string[], select: string) {
  if (!ids.length) return [] as Record<string, string>[];
  const q = new URLSearchParams({ select, [col]: `in.(${ids.map((i) => `"${i}"`).join(",")})` });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return r.ok ? await r.json() as Record<string, string>[] : [];
}

const CATEGORY: Record<string, string> = {
  application_fee: "fees", application_fee_refund: "fees",
  charge: "subscriptions", payment: "subscriptions", refund: "subscriptions", payment_refund: "subscriptions", payment_failure_refund: "subscriptions",
  transfer: "payouts", transfer_refund: "payouts", transfer_cancel: "payouts", transfer_failure: "payouts",
};
const LABEL: Record<string, string> = {
  application_fee: "Payment fee", application_fee_refund: "Payment fee refunded",
  charge: "Plan payment", payment: "Plan payment", refund: "Plan refund", payment_refund: "Plan refund", payment_failure_refund: "Failed payment returned",
  transfer: "Referral payout", transfer_refund: "Referral payout returned", transfer_cancel: "Referral payout cancelled", transfer_failure: "Referral payout failed",
  stripe_fee: "Stripe fee", tax_fee: "Stripe Tax fee",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Day = { day: string; fees: number; subscriptions: number; costs: number };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // The gateway already verified the signature; only the role is checked here.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let role = "";
  try { role = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? ""; } catch { /* not a JWT */ }
  if (role !== "service_role") return json({ error: "Forbidden" }, 403);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  let body: { from?: string | null; to?: string | null; tz?: string; detail?: string };
  try { body = await req.json(); } catch { body = {}; }
  const from = body.from ? Math.floor(new Date(body.from).getTime() / 1000) : null;
  const to   = body.to   ? Math.floor(new Date(body.to).getTime() / 1000)   : null;
  let tz = "UTC";
  try { if (body.tz) { new Intl.DateTimeFormat("en-CA", { timeZone: body.tz }); tz = body.tz; } } catch { /* bad zone → UTC */ }
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });

  const t = {
    applicationFees: 0, applicationFeeRefunds: 0,
    subscriptions: 0, subscriptionRefunds: 0,
    stripeCosts: 0, referralPayouts: 0, adjustments: 0,
  };
  const days = new Map<string, Day>();
  const bucket = (created: number) => {
    const k = dayKey.format(new Date(created * 1000));
    let d = days.get(k);
    if (!d) { d = { day: k, fees: 0, subscriptions: 0, costs: 0 }; days.set(k, d); }
    return d;
  };
  let currency = "";
  let count = 0;
  const detail = body.detail ?? null;
  const lines: Line[] = [];

  let startingAfter: string | null = null;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ limit: "100" });
    if (from !== null) q.set("created[gte]", String(from));
    if (to   !== null) q.set("created[lt]",  String(to));
    if (startingAfter) q.set("starting_after", startingAfter);
    if (detail) q.append("expand[]", "data.source");
    const res = await fetch(`https://api.stripe.com/v1/balance_transactions?${q}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const list = await res.json();
    if (!res.ok) return json({ error: list?.error?.message ?? `Stripe ${res.status}` }, 502);

    for (const bt of list.data as Array<{ id: string; type: string; amount: number; fee: number; net: number; created: number; currency: string; description: string | null; source: any }>) {
      count++;
      if (detail) {
        const cat = CATEGORY[bt.type];
        const src = bt.source && typeof bt.source === "object" ? bt.source : {};
        const base = {
          id: bt.id, user_id: null, at: new Date(bt.created * 1000).toISOString(),
          account: (src.account ?? src.destination ?? null) as string | null,
          customer: (src.customer ?? null) as string | null,
        };
        // Stripe's own "Application fee from application …" says nothing new.
        const desc = [bt.description, src.description, src.billing_details?.email]
          .find((d) => d && !String(d).startsWith("Application fee from")) ?? "";
        // Each transaction's share of each figure on the Revenue card.
        const isStripeFee = bt.type === "stripe_fee" || bt.type === "tax_fee";
        const cost = isStripeFee ? -bt.net / 100 : (cat === "payouts" ? 0 : bt.fee / 100);
        const parts: Array<{ kind: "revenue" | "cost" | "payout" | "adjustment"; title: string; value: number }> = [];
        if (cat === "fees" || cat === "subscriptions") parts.push({ kind: "revenue", title: LABEL[bt.type] ?? bt.type, value: bt.amount / 100 });
        if (cat === "payouts") parts.push({ kind: "payout", title: LABEL[bt.type] ?? bt.type, value: -bt.net / 100 });
        if (cost) parts.push({ kind: "cost", title: isStripeFee ? LABEL[bt.type] : `Stripe fee on ${(LABEL[bt.type] ?? bt.type).toLowerCase()}`, value: cost });
        if (bt.type === "adjustment") parts.push({ kind: "adjustment", title: "Adjustment", value: bt.net / 100 });
        for (const part of parts) {
          const keep =
            detail === cat && part.kind === "revenue" ||
            detail === "revenue" && part.kind === "revenue" ||
            detail === "costs" && part.kind === "cost" ||
            detail === "payouts" && part.kind === "payout" ||
            detail === "all_costs" && (part.kind === "cost" || part.kind === "payout") ||
            detail === "net";
          if (!keep) continue;
          const sign = detail === "net" && (part.kind === "cost" || part.kind === "payout") ? -1 : 1;
          lines.push({ ...base, id: `${bt.id}:${part.kind}`, title: part.title, subtitle: desc, value: sign * part.value });
        }
      }
      currency ||= bt.currency;
      const amt = bt.amount / 100, fee = bt.fee / 100, net = bt.net / 100;
      const d = bucket(bt.created);
      switch (bt.type) {
        case "application_fee":
          t.applicationFees += amt; t.stripeCosts += fee; d.fees += amt; d.costs += fee; break;
        case "application_fee_refund":
          t.applicationFeeRefunds += amt; d.fees += amt; break;
        case "charge": case "payment":
          t.subscriptions += amt; t.stripeCosts += fee; d.subscriptions += amt; d.costs += fee; break;
        case "refund": case "payment_refund": case "payment_failure_refund":
          t.subscriptionRefunds += amt; t.stripeCosts += fee; d.subscriptions += amt; d.costs += fee; break;
        case "stripe_fee": case "tax_fee":
          t.stripeCosts += -net; d.costs += -net; break;
        case "transfer": case "transfer_refund": case "transfer_cancel": case "transfer_failure":
          t.referralPayouts += -net; d.costs += -net; break;
        case "adjustment":
          t.adjustments += net; break;
        default:
          break; // payouts, top-ups, reserves: money moving, not revenue
      }
    }
    if (!list.has_more || !list.data.length) break;
    startingAfter = list.data[list.data.length - 1].id;
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Who each line came from: a vendor's connected account, a plan customer, or
  // a referral payout's destination (vendor or Growth Partner).
  if (lines.length) {
    const accounts = [...new Set(lines.map((l) => l.account).filter(Boolean))] as string[];
    const customers = [...new Set(lines.map((l) => l.customer).filter(Boolean))] as string[];
    const [shops, partners, plans] = await Promise.all([
      lookup("profiles", "stripe_connect_account_id", accounts, "id,business_name,user_name,stripe_connect_account_id"),
      lookup("growth_partners", "stripe_connect_account_id", accounts, "user_id,name,stripe_connect_account_id"),
      lookup("vendor_plans", "stripe_customer_id", customers, "user_id,stripe_customer_id"),
    ]);
    const byAccount = new Map<string, { id: string; name: string }>();
    for (const p of shops) byAccount.set(p.stripe_connect_account_id, { id: p.id, name: p.business_name || p.user_name || "" });
    for (const p of partners) byAccount.set(p.stripe_connect_account_id, { id: p.user_id, name: p.name || "" });
    const planUser = new Map(plans.map((p) => [p.stripe_customer_id, p.user_id]));
    const names = new Map((await lookup("profiles", "id", [...new Set(plans.map((p) => p.user_id))], "id,business_name,user_name"))
      .map((p) => [p.id, p.business_name || p.user_name || ""]));
    for (const l of lines) {
      const a = l.account ? byAccount.get(l.account) : undefined;
      const u = l.customer ? planUser.get(l.customer) : undefined;
      l.user_id = a?.id ?? u ?? null;
      const who = a?.name || (u ? names.get(u) : "") || "";
      if (who) l.title = `${who}: ${l.title.charAt(0).toLowerCase()}${l.title.slice(1)}`;
      l.value = r2(l.value);
      delete l.account; delete l.customer;
    }
  }
  const revenue = t.applicationFees + t.applicationFeeRefunds + t.subscriptions + t.subscriptionRefunds;
  const net = revenue - t.stripeCosts - t.referralPayouts + t.adjustments;
  return json({
    currency: currency || "cad",
    transactions: count,
    totals: {
      application_fees: r2(t.applicationFees),
      application_fee_refunds: r2(t.applicationFeeRefunds),
      subscriptions: r2(t.subscriptions),
      subscription_refunds: r2(t.subscriptionRefunds),
      revenue: r2(revenue),
      stripe_costs: r2(t.stripeCosts),
      referral_payouts: r2(t.referralPayouts),
      adjustments: r2(t.adjustments),
      net: r2(net),
    },
    ...(detail ? { lines } : {}),
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ day: d.day, fees: r2(d.fees), subscriptions: r2(d.subscriptions), costs: r2(d.costs) })),
  });
});
