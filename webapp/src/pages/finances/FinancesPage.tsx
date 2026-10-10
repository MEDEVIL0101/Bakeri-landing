import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listOrders, effectiveTotal, isStorefrontOrder, revenueReceived, statusLabel, statusTone } from '../../lib/orders';
import { formatDate, formatMoney, toDateInput } from '../../lib/format';
import {
  formatWeight, ingredientAmounts, ingredientCost, listCostingRecipes, listIngredientCosts, type CostingRecipe, type IngredientCostRow,
} from '../../lib/kitchen';
import { useUnitSystem } from '../../lib/prefs';
import type { Order } from '../../lib/types';
import { BarChart } from './BarChart';

type Period = 'week' | 'month' | 'year' | 'custom';
type Metric = 'revenue' | 'costs' | 'profit' | 'orders';

const DAY = 86400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** iOS FinancialReportView date range, offset-aware (‹ › steps whole periods). */
function rangeFor(period: Period, offset: number, custom: { from: string; to: string }): [Date, Date] {
  const now = new Date();
  if (period === 'week') {
    const s = startOfDay(now);
    s.setDate(s.getDate() - s.getDay() + offset * 7);
    return [s, new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7)];
  }
  if (period === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return [s, new Date(s.getFullYear(), s.getMonth() + 1, 1)];
  }
  if (period === 'year') {
    const s = new Date(now.getFullYear() + offset, 0, 1);
    return [s, new Date(s.getFullYear() + 1, 0, 1)];
  }
  const from = custom.from ? new Date(`${custom.from}T00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = custom.to ? new Date(`${custom.to}T00:00`) : startOfDay(now);
  return [from, new Date(to.getTime() + DAY)];
}

function rangeLabel(period: Period, [s, e]: [Date, Date]): string {
  if (period === 'month') return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (period === 'year') return String(s.getFullYear());
  const end = new Date(e.getTime() - DAY);
  return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function segmentsFor(period: Period, [s, e]: [Date, Date]): { label: string; start: Date; end: Date }[] {
  const out: { label: string; start: Date; end: Date }[] = [];
  if (period === 'week') {
    for (let i = 0; i < 7; i++) { const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i); out.push({ label: d.toLocaleDateString(undefined, { weekday: 'short' }), start: d, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) }); }
  } else if (period === 'month') {
    for (let w = 0; w < 6; w++) { const ws = new Date(s.getFullYear(), s.getMonth(), s.getDate() + w * 7); if (ws >= e) break; out.push({ label: `Wk ${w + 1}`, start: ws, end: new Date(Math.min(e.getTime(), ws.getTime() + 7 * DAY)) }); }
  } else if (period === 'year') {
    for (let m = 0; m < 12; m++) { const ms = new Date(s.getFullYear(), m, 1); out.push({ label: ms.toLocaleDateString(undefined, { month: 'short' }), start: ms, end: new Date(s.getFullYear(), m + 1, 1) }); }
  } else {
    const days = (e.getTime() - s.getTime()) / DAY;
    if (days <= 92) {
      for (let c = new Date(s); c < e && out.length < 14; c = new Date(c.getTime() + 7 * DAY)) out.push({ label: c.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), start: c, end: new Date(Math.min(e.getTime(), c.getTime() + 7 * DAY)) });
    } else {
      for (let c = new Date(s.getFullYear(), s.getMonth(), 1); c < e; c = new Date(c.getFullYear(), c.getMonth() + 1, 1)) out.push({ label: c.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), start: c, end: new Date(Math.min(e.getTime(), new Date(c.getFullYear(), c.getMonth() + 1, 1).getTime())) });
    }
  }
  return out;
}

export function FinancesPage() {
  const userId = useUserId();
  const data = useLoad(async () => {
    const [orders, recipes, costs] = await Promise.all([listOrders(userId), listCostingRecipes(userId), listIngredientCosts(userId)]);
    return { orders, recipes, costs };
  }, [userId]);

  if (data.loading && !data.data) return <div className="page"><Spinner label="Crunching your numbers…" /></div>;
  if (!data.data) return <div className="page"><ErrorBanner message={data.error ?? 'Couldn’t load your orders.'} onRetry={data.reload} /></div>;
  return <Report {...data.data} />;
}

function Report({ orders, recipes, costs }: { orders: Order[]; recipes: CostingRecipe[]; costs: IngredientCostRow[] }) {
  const [period, setPeriod] = useState<Period>('month');
  const [offset, setOffset] = useState(0);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [custom, setCustom] = useState({ from: toDateInput(new Date(Date.now() - 30 * DAY).toISOString()), to: toDateInput(new Date().toISOString()) });
  const [units] = useUnitSystem();
  const range = rangeFor(period, offset, custom);
  const [s, e] = range;

  const costOf = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof ingredientAmounts>>();
    return (o: Order) => {
      if (!cache.has(o.id)) cache.set(o.id, ingredientAmounts((o.order_items ?? []).map((i) => ({ recipe_id: i.recipe_id, custom_name: i.custom_name, quantity: i.quantity, unit: i.unit })), recipes, costs));
      return cache.get(o.id)!;
    };
  }, [recipes, costs]);

  const inPeriod = orders.filter((o) => { const d = new Date(o.due_date); return d >= s && d < e; });
  const revenue = orders.reduce((t, o) => t + revenueReceived(o, s, e), 0);
  const cost = inPeriod.reduce((t, o) => t + ingredientCost(costOf(o)), 0);
  const profit = revenue - cost;
  const pending = inPeriod.filter((o) => !o.is_paid && !['Cancelled', 'Completed'].includes(o.status)).reduce((t, o) => t + effectiveTotal(o), 0);
  const paidCount = inPeriod.filter((o) => o.is_paid).length;

  const segments = segmentsFor(period, range).map((seg) => {
    const segOrders = inPeriod.filter((o) => { const d = new Date(o.due_date); return d >= seg.start && d < seg.end; });
    const rev = orders.reduce((t, o) => t + revenueReceived(o, seg.start, seg.end), 0);
    const c = segOrders.reduce((t, o) => t + ingredientCost(costOf(o)), 0);
    return { label: seg.label, revenue: rev, costs: c, profit: rev - c, orders: segOrders.length };
  });

  const series = metric === 'revenue'
    ? [{ key: 'revenue', label: 'Revenue', color: 'var(--chart-1)' }, ...(costs.length ? [{ key: 'costs', label: 'Costs', color: 'var(--chart-2)' }] : [])]
    : metric === 'costs' ? [{ key: 'costs', label: 'Costs', color: 'var(--chart-2)' }]
      : metric === 'profit' ? [{ key: 'profit', label: 'Profit', color: 'var(--chart-3)' }]
        : [{ key: 'orders', label: 'Orders', color: 'var(--chart-4)' }];

  // Ingredient totals across the period.
  const ingredients = useMemo(() => {
    const m = new Map<string, { name: string; grams: number; cost: number; priced: boolean }>();
    for (const o of inPeriod) for (const a of costOf(o)) {
      const k = a.ingredient.toLowerCase();
      const cur = m.get(k) ?? { name: a.ingredient, grams: 0, cost: 0, priced: a.hasCost };
      cur.grams += a.grams; cur.cost += a.grams * a.costPerGram; cur.priced = cur.priced || a.hasCost;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost || b.grams - a.grams);
  }, [inPeriod, costOf]);

  const listOrdersSorted = [...inPeriod].sort((a, b) => {
    if (metric === 'costs') return ingredientCost(costOf(b)) - ingredientCost(costOf(a));
    if (metric === 'profit') return (effectiveTotal(b) - ingredientCost(costOf(b))) - (effectiveTotal(a) - ingredientCost(costOf(a)));
    if (metric === 'orders') return Date.parse(a.due_date) - Date.parse(b.due_date);
    return effectiveTotal(b) - effectiveTotal(a);
  });

  function exportCSV() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      `Bakeri financial report,${esc(rangeLabel(period, range))}`,
      `Revenue received,${revenue.toFixed(2)}`, `Ingredient costs,${cost.toFixed(2)}`, `Profit,${profit.toFixed(2)}`, `Pending,${pending.toFixed(2)}`, '',
      'Order,Customer,Due date,Status,Total,Paid,Ingredient cost,Profit,Source',
      ...listOrdersSorted.map((o) => {
        const c = ingredientCost(costOf(o));
        return [o.order_name || 'Order', o.customer_name || o.buyer_display_name || '', toDateInput(o.due_date), statusLabel(o), effectiveTotal(o).toFixed(2), o.is_paid ? 'Yes' : 'No', c.toFixed(2), (effectiveTotal(o) - c).toFixed(2), isStorefrontOrder(o) ? 'Storefront' : 'Manual'].map((x) => esc(String(x))).join(',');
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bakeri-report-${toDateInput(s.toISOString())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="page">
      <PageHeader title="Finances" subtitle="Money in, ingredient costs, and profit."
        actions={<Button variant="secondary" onClick={exportCSV}>Export CSV</Button>} />

      <div className="toolbar">
        <div className="seg">
          {(['week', 'month', 'year', 'custom'] as Period[]).map((p) => (
            <button key={p} className={period === p ? 'active' : ''} onClick={() => { setPeriod(p); setOffset(0); }}>{p[0].toUpperCase() + p.slice(1)}</button>
          ))}
        </div>
        {period === 'custom' ? (
          <div className="btn-row">
            <Input type="date" value={custom.from} max={custom.to} onChange={(ev) => setCustom({ ...custom, from: ev.target.value })} />
            <span className="muted">to</span>
            <Input type="date" value={custom.to} min={custom.from} onChange={(ev) => setCustom({ ...custom, to: ev.target.value })} />
          </div>
        ) : (
          <div className="period-nav">
            <button className="icon-btn" aria-label="Previous" onClick={() => setOffset(offset - 1)}>‹</button>
            <span className="period-label">{rangeLabel(period, range)}</span>
            <button className="icon-btn" aria-label="Next" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}>›</button>
          </div>
        )}
      </div>

      <div className="metric-grid">
        <MetricTile active={metric === 'revenue'} onClick={() => setMetric('revenue')} label="Revenue received" value={formatMoney(revenue)} sub={`${paidCount} paid order${paidCount === 1 ? '' : 's'}${pending > 0 ? ` · ${formatMoney(pending)} pending` : ''}`} tone="1" />
        <MetricTile active={metric === 'costs'} onClick={() => setMetric('costs')} label="Ingredient costs" value={costs.length ? formatMoney(cost) : '—'} sub={costs.length ? 'From your ingredient prices' : 'Add ingredient prices to see costs'} tone="2" />
        <MetricTile active={metric === 'profit'} onClick={() => setMetric('profit')} label="Profit" value={formatMoney(profit)} sub={revenue > 0 ? `${Math.round((profit / revenue) * 100)}% margin` : 'Revenue minus ingredient costs'} tone="3" />
        <MetricTile active={metric === 'orders'} onClick={() => setMetric('orders')} label="Orders" value={String(inPeriod.length)} sub="Due in this period" tone="4" />
      </div>

      <Card title={{ revenue: 'Overview', costs: 'Ingredient costs', profit: 'Profit', orders: 'Order count' }[metric]}
        actions={<div className="legend">{series.map((x) => <span key={x.key}><i style={{ background: x.color }} />{x.label}</span>)}</div>}>
        <BarChart data={segments} series={series} format={metric === 'orders' ? (n) => String(Math.round(n)) : (n) => formatMoney(n)} />
      </Card>

      <div className="detail-grid">
        <Card title={{ revenue: 'By revenue', costs: 'By cost', profit: 'By profit', orders: 'All orders' }[metric]} actions={<Badge>{inPeriod.length}</Badge>}>
          {!listOrdersSorted.length ? <EmptyState title="No orders in this period" /> : (
            <ul className="list">
              {listOrdersSorted.map((o) => {
                const c = ingredientCost(costOf(o));
                return (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="list-row link-row">
                      <span className="grow">
                        <span className="row-title">{o.order_name || o.buyer_display_name || o.customer_name || 'Order'}</span>
                        <span className="row-sub">{formatDate(o.due_date)} · <Badge tone={statusTone(o)}>{statusLabel(o)}</Badge></span>
                      </span>
                      <span className="row-end">
                        <span className={`row-amount ${o.is_paid ? '' : 'muted'}`}>{metric === 'costs' ? formatMoney(c) : metric === 'profit' ? formatMoney(effectiveTotal(o) - c) : formatMoney(effectiveTotal(o))}</span>
                        {metric !== 'revenue' && metric !== 'orders' && <span className="small muted">of {formatMoney(effectiveTotal(o))}</span>}
                        {metric === 'revenue' && isStorefrontOrder(o) && <span className="small muted">{o.baker_payout_cents != null ? '' : '~'}{formatMoney(netPayout(o))} net</span>}
                        {!o.is_paid && <span className="small unpaid">Unpaid</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Ingredients used" actions={<Link to="/ingredients" className="small">Prices →</Link>}>
          {!ingredients.length ? <p className="small muted">Link recipes to your orders’ items to see ingredient totals and costs here.</p> : (
            <div className="table-scroll"><table className="table compact">
              <thead><tr><th>Ingredient</th><th className="num">Weight</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {ingredients.slice(0, 40).map((i) => (
                  <tr key={i.name}>
                    <td>{i.name}</td>
                    <td className="num">{formatWeight(i.grams, units === 'metric')}</td>
                    <td className="num">{i.priced ? formatMoney(i.cost) : <Link to={`/ingredients?add=${encodeURIComponent(i.name)}`} className="small">Add price</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Order.netPayoutEstimate */
function netPayout(o: Order): number {
  if (o.baker_payout_cents != null) return o.baker_payout_cents / 100;
  const t = effectiveTotal(o);
  const fee = o.platform_fee_cents != null ? o.platform_fee_cents / 100 : t * 0.05;
  return Math.max(0, t - fee - (t * 0.029 + 0.3));
}

function MetricTile({ active, onClick, label, value, sub, tone }: { active: boolean; onClick: () => void; label: string; value: string; sub: string; tone: string }) {
  return (
    <button className={`metric ${active ? 'active' : ''}`} onClick={onClick} style={{ ['--tone' as any]: `var(--chart-${tone})` }}>
      <span className="metric-label"><i />{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </button>
  );
}
