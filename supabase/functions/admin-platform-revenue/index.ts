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
// Body: { from?: ISO date, to?: ISO date, tz?: IANA zone for daily buckets }
// Amounts are in the platform's settlement currency, in major units.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

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

  let body: { from?: string | null; to?: string | null; tz?: string };
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

  let startingAfter: string | null = null;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ limit: "100" });
    if (from !== null) q.set("created[gte]", String(from));
    if (to   !== null) q.set("created[lt]",  String(to));
    if (startingAfter) q.set("starting_after", startingAfter);
    const res = await fetch(`https://api.stripe.com/v1/balance_transactions?${q}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const list = await res.json();
    if (!res.ok) return json({ error: list?.error?.message ?? `Stripe ${res.status}` }, 502);

    for (const bt of list.data as Array<{ id: string; type: string; amount: number; fee: number; net: number; created: number; currency: string }>) {
      count++;
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
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ day: d.day, fees: r2(d.fees), subscriptions: r2(d.subscriptions), costs: r2(d.costs) })),
  });
});
