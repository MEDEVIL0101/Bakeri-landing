import { useState } from 'react';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { check } from '../../lib/api';
import { BarChart } from '../finances/BarChart';

/**
 * Storefront Insights — first-party visit analytics for the vendor's own
 * storefront (migration 20261030000002_storefront_analytics). Everything comes
 * from get_my_storefront_stats(), which only ever returns the signed-in
 * vendor's own shop. Visits from the vendor's own "View my site" links
 * (?self=1) aren't counted.
 */

type Range = 7 | 30 | 90 | 365;
const RANGES: { days: Range; label: string }[] = [
  { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '12 months' },
];
// Tracking went live on the storefront on this day — nothing before it.
const TRACKING_START = '2026-10-30';

interface Stats {
  totals: {
    views: number; visitors: number; returning: number; sessions: number;
    item_views: number; add_to_cart: number; cart_open: number; checkout_start: number;
    form_open: number; form_submit: number; link_clicks: number; social_clicks: number;
  };
  orders: number;
  by_day: { day: string; views: number; visitors: number }[];
  sources: { source: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  countries: { country: string; visitors: number }[];
  items: { id: string; name: string | null; views: number; adds: number }[];
  links: { id: string | null; label: string | null; kind: string; clicks: number }[];
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

async function loadStats(from: Date, to: Date): Promise<Stats> {
  return check(await supabase.rpc('get_my_storefront_stats', { p_from: ymd(from), p_to: ymd(to), p_tz: TZ })) as Stats;
}

const SOURCE_NAMES: Record<string, string> = {
  direct: 'Direct or typed in', instagram: 'Instagram', ig: 'Instagram', fb: 'Facebook', tt: 'TikTok', facebook: 'Facebook', tiktok: 'TikTok', google: 'Google',
  pinterest: 'Pinterest', youtube: 'YouTube', x: 'X (Twitter)', twitter: 'X (Twitter)', linkedin: 'LinkedIn',
  reddit: 'Reddit', bing: 'Bing', email: 'Email', bakeri: 'Bakerï',
};
const sourceName = (s: string) => SOURCE_NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
const regionNames = (() => { try { return new Intl.DisplayNames(undefined, { type: 'region' }); } catch { return null; } })();
const countryName = (c: string) => regionNames?.of(c) ?? c;
const fmt = (n: number) => n.toLocaleString();
/** "ig" and "instagram" are the same place — add them up under one name. */
function mergeByName(rows: { name: string; n: number }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.name, (m.get(r.name) ?? 0) + r.n);
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');

function change(now: number, before: number): string | null {
  if (before <= 0) return null;
  const p = Math.round(((now - before) / before) * 100);
  return `${p >= 0 ? '+' : ''}${p}% vs the previous period`;
}

/** Daily visitors, rolled up to weeks or months on long ranges so bars stay readable. */
function trend(stats: Stats, from: Date, days: Range): { label: string; visitors: number; views: number }[] {
  const byDay = new Map(stats.by_day.map((d) => [d.day, d]));
  const out: { label: string; visitors: number; views: number }[] = [];
  const bucket = days <= 31 ? 1 : days <= 120 ? 7 : 0; // 0 = calendar month
  if (bucket === 0) {
    const months = new Map<string, { label: string; visitors: number; views: number }>();
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const row = months.get(key) ?? { label: d.toLocaleDateString(undefined, { month: 'short' }), visitors: 0, views: 0 };
      const s = byDay.get(ymd(d));
      if (s) { row.visitors += s.visitors; row.views += s.views; }
      months.set(key, row);
    }
    return [...months.values()];
  }
  for (let i = 0; i < days; i += bucket) {
    const start = addDays(from, i);
    let visitors = 0, views = 0;
    for (let j = 0; j < bucket && i + j < days; j++) {
      const s = byDay.get(ymd(addDays(from, i + j)));
      if (s) { visitors += s.visitors; views += s.views; }
    }
    out.push({
      label: bucket === 1
        ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      visitors, views,
    });
  }
  return out;
}

export function InsightsPage() {
  const [days, setDays] = useState<Range>(30);
  const to = new Date();
  const from = addDays(to, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  // Counted only from the day tracking began, so orders and visits cover the
  // same days (otherwise 30 days of orders against 2 days of visits read as
  // a conversion rate of several hundred percent).
  const start = new Date(`${TRACKING_START}T00:00:00`);
  const clamp = (d: Date) => (d < start ? start : d);
  const data = useLoad(async () => {
    const now = await loadStats(clamp(from), to);
    // No comparison until the whole previous period was tracked.
    const before = prevFrom >= start ? await loadStats(prevFrom, prevTo) : null;
    return { now, before };
  }, [days]);

  return (
    <div className="page">
      <PageHeader title="Insights" subtitle="Who’s visiting your storefront, where they come from, and what turns into orders." />

      <div className="toolbar">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>{r.label}</button>
          ))}
        </div>
        <span className="small muted">
          {from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {data.error && <ErrorBanner message={data.error} onRetry={data.reload} />}
      {!data.data && !data.error && <Spinner label="Loading your insights…" />}
      {data.data && <Report stats={data.data.now} before={data.data.before} from={from} days={days} />}
    </div>
  );
}

function Report({ stats, before, from, days }: { stats: Stats; before: Stats | null; from: Date; days: Range }) {
  const t = stats.totals;
  const startedLate = ymd(from) < TRACKING_START;
  // Bars only from the day tracking began — empty bars before then were most of the chart.
  const chartFrom = startedLate ? new Date(`${TRACKING_START}T00:00:00`) : from;
  const chartDays = Math.max(1, Math.round((Date.now() - chartFrom.getTime()) / 86400000) + 1);
  const points = trend(stats, chartFrom, Math.min(days, chartDays) as Range);
  const conversion = stats.orders > t.visitors ? '—' : pct(stats.orders, t.visitors);

  if (t.visitors === 0 && t.views === 0) {
    return (
      <Card>
        <EmptyState
          title="No visits in this range yet"
          body="Share your storefront link on Instagram, TikTok or anywhere your customers are. Visits show up here within a minute. Your own visits from “View my site” aren’t counted."
        />
      </Card>
    );
  }

  const funnel = [
    { label: 'Visited your storefront', n: t.visitors },
    { label: 'Viewed a product', n: t.item_views },
    { label: 'Added to cart', n: t.add_to_cart },
    { label: 'Started checkout', n: t.checkout_start },
    { label: 'Placed an order', n: stats.orders },
  ];
  const top = Math.max(1, t.visitors);

  return (
    <>
      <div className="metric-grid ins-tiles">
        <Tile label="Visitors" value={fmt(t.visitors)} sub={(before && change(t.visitors, before.totals.visitors)) ?? `${fmt(t.returning)} returning`} tone="1" />
        <Tile label="Page views" value={fmt(t.views)} sub={t.visitors > 0 ? `${(t.views / t.visitors).toFixed(1)} per visitor` : ''} tone="3" />
        <Tile label="Storefront orders" value={fmt(stats.orders)} sub={(before && change(stats.orders, before.orders)) ?? 'Orders and requests from your storefront'} tone="4" />
        <Tile label="Conversion" value={conversion} sub="Visitors who placed an order" tone="2" />
        <Tile label="Link clicks" value={fmt(t.link_clicks + t.social_clicks)} sub={`${fmt(t.social_clicks)} on social icons`} tone="5" />
      </div>

      <Card title="Visitors over time" className="ins-chart">
        <BarChart data={points} labelEvery={Math.max(1, Math.ceil(points.length / 10))}
          series={[{ key: 'visitors', label: 'Visitors', color: 'var(--chart-1)' }]}
          format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })} />
        {startedLate && <p className="small muted">Insights started on Oct 30, 2026, so there’s nothing to show before then.</p>}
      </Card>

      <div className="grid-2 ins-grid">
        <Card title="From visit to order">
          <div className="ins-funnel">
            {funnel.map((f, i) => (
              <div key={f.label} className="ins-row">
                <span className="ins-label">{f.label}</span>
                <span className="ins-track"><span className="ins-fill" style={{ width: `${Math.min(100, Math.max(2, (f.n / top) * 100))}%`, opacity: 1 - i * 0.14 }} /></span>
                <span className="ins-num">{fmt(f.n)}</span>
                <span className="ins-pct">{i === 0 || f.n > top ? '' : pct(f.n, top)}</span>
              </div>
            ))}
          </div>
          {(t.form_open > 0 || t.form_submit > 0) && (
            <p className="small muted">Order forms: opened {fmt(t.form_open)} times, sent {fmt(t.form_submit)} ({pct(t.form_submit, t.form_open)}).</p>
          )}
          <p className="small muted">Product views and cart adds count actions, not people, so one visitor can count more than once.</p>
        </Card>

        <Card title="Where visitors come from">
          <Breakdown rows={mergeByName(stats.sources.map((s) => ({ name: sourceName(s.source), n: s.visitors })))} empty="No visits yet." />
          <p className="small muted">Add <code>?utm_source=newsletter</code> (or any name) to a link you share to see it here by name.</p>
        </Card>
      </div>

      <div className="grid-2 ins-grid">
        <Card title="Top products">
          {stats.items.length === 0 ? <p className="muted small">No product views yet.</p> : (
            <table className="table ins-table">
              <thead><tr><th>Product</th><th className="num">Views</th><th className="num">Added to cart</th></tr></thead>
              <tbody>
                {stats.items.slice(0, 10).map((it) => (
                  <tr key={it.id}>
                    <td className="ellipsis">{it.name ?? 'A removed product'}</td>
                    <td className="num">{fmt(it.views)}</td>
                    <td className="num">{fmt(it.adds)}{it.views > 0 && <span className="muted"> · {pct(it.adds, it.views)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Link and social clicks">
          {stats.links.length === 0 ? <p className="muted small">No link clicks yet.</p> : (
            <table className="table ins-table">
              <thead><tr><th>Link</th><th className="num">Clicks</th></tr></thead>
              <tbody>
                {stats.links.slice(0, 10).map((l, i) => (
                  <tr key={(l.id ?? '') + i}>
                    <td className="ellipsis">{l.label ?? (l.kind === 'social_click' ? 'Social icon' : 'A removed link')}{l.kind === 'social_click' && l.label ? <span className="muted"> · social</span> : null}</td>
                    <td className="num">{fmt(l.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid-2 ins-grid">
        <Card title="Devices">
          <Breakdown rows={stats.devices.map((d) => ({ name: d.device === 'mobile' ? 'Phone' : d.device === 'desktop' ? 'Computer' : d.device, n: d.visitors }))} empty="No visits yet." />
        </Card>
        <Card title="Countries">
          <Breakdown rows={stats.countries.map((c) => ({ name: countryName(c.country), n: c.visitors }))} empty="Country isn’t known for these visits." />
        </Card>
      </div>

      <p className="small muted ins-note">
        Counted by Bakerï itself, with no outside tracking service. Bots are filtered out, and your own visits from “View my site” aren’t counted. Visitors in the EU and UK are counted once per day, so returning visitors may be a little low.
      </p>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="metric static" style={{ ['--tone' as any]: `var(--chart-${tone})` }}>
      <span className="metric-label"><i />{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

function Breakdown({ rows, empty }: { rows: { name: string; n: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  return (
    <div className="ins-funnel">
      {rows.slice(0, 8).map((r) => (
        <div key={r.name} className="ins-row">
          <span className="ins-label ellipsis">{r.name}</span>
          <span className="ins-track"><span className="ins-fill" style={{ width: `${Math.max(2, (r.n / total) * 100)}%` }} /></span>
          <span className="ins-num">{fmt(r.n)}</span>
          <span className="ins-pct">{pct(r.n, total)}</span>
        </div>
      ))}
    </div>
  );
}
