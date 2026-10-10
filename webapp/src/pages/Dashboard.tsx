import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useUserId } from '../auth/AuthProvider';
import { Badge, Card, EmptyState, ErrorBanner, Spinner, useLoad, useToast } from '../components/ui';
import {
  listOrders, effectiveTotal, isClosed, isStorefrontOrder, isUnacceptedQuote, needsAction, revenueReceived, statusLabel, statusTone,
} from '../lib/orders';
import { listTasks, listUnavailableDates } from '../lib/data';
import { listMenuItems, menuImageURL, type MenuItemFull } from '../lib/menu';
import { formatDate, formatMoney, sameDay } from '../lib/format';
import { STORAGE_PUBLIC_URL, supabase } from '../lib/supabase';
import { usePref } from '../lib/prefs';
import type { Order } from '../lib/types';

type Period = 'day' | 'week' | 'month' | '90';
const DAY = 86400_000;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up early' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** iOS HomeView ranges: the current period and the one before it. */
function ranges(p: Period): { cur: [Date, Date]; prev: [Date, Date]; label: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'day') return { cur: [today, new Date(today.getTime() + DAY)], prev: [new Date(today.getTime() - DAY), today], label: 'today' };
  if (p === 'week') {
    const s = new Date(today); s.setDate(s.getDate() - s.getDay());
    return { cur: [s, new Date(s.getTime() + 7 * DAY)], prev: [new Date(s.getTime() - 7 * DAY), s], label: 'this week' };
  }
  if (p === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { cur: [s, new Date(now.getFullYear(), now.getMonth() + 1, 1)], prev: [new Date(now.getFullYear(), now.getMonth() - 1, 1), s], label: 'this month' };
  }
  const s = new Date(today.getTime() - 89 * DAY);
  return { cur: [s, new Date(today.getTime() + DAY)], prev: [new Date(s.getTime() - 90 * DAY), s], label: 'last 90 days' };
}

export function DashboardPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const orders = useLoad(() => listOrders(userId), [userId]);
  const tasks = useLoad(() => listTasks(userId), [userId]);
  const items = useLoad(() => listMenuItems(userId), [userId]);
  const away = useLoad(() => listUnavailableDates(userId), [userId]);
  const [period, setPeriod] = usePref<Period>('bakeri.home.period', 'week');

  const firstName = profile?.user_name?.split(' ')[0];
  const now = new Date();
  const all = orders.data ?? [];
  const actionable = all.filter(needsAction);
  const unpaid = all.filter((o) => !o.is_paid && !isClosed(o) && !isUnacceptedQuote(o) && o.marketplace_status !== 'pending');
  const due48 = all.filter((o) => !isClosed(o) && !needsAction(o) && Date.parse(o.due_date) - Date.now() < 2 * DAY && Date.parse(o.due_date) > Date.now() - DAY);
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const shipKinds = new Set((items.data ?? []).filter((m) => m.listing_kind === 'physical').map((m) => m.id.toLowerCase()));
  const isShipping = (o: Order) => !!o.shipping_address || (o.order_items ?? []).some((i) => i.menu_item_id && shipKinds.has(i.menu_item_id.toLowerCase()));
  const toShip = all.filter((o) => isShipping(o) && ['awaiting_shipment', 'preparing', 'confirmed'].includes(o.marketplace_status ?? '') && !isClosed(o));
  const foodInProgress = all
    .filter((o) => !isClosed(o) && !needsAction(o) && !isShipping(o) && !isUnacceptedQuote(o) && new Date(o.due_date) < weekEnd)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const todaysTasks = (tasks.data ?? []).filter((t) => !t.is_completed && sameDay(new Date(t.due_date), now));

  // Storefront sales for the chosen period, vs the one before.
  const r = ranges(period);
  const sf = all.filter(isStorefrontOrder);
  const inRange = (o: Order, [s, e]: [Date, Date]) => { const d = new Date(o.due_date); return d >= s && d < e && o.status !== 'Cancelled' && !isUnacceptedQuote(o); };
  const revenue = sf.reduce((t, o) => t + revenueReceived(o, ...r.cur), 0);
  const prevRevenue = sf.reduce((t, o) => t + revenueReceived(o, ...r.prev), 0);
  const delta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
  const sales = sf.filter((o) => inRange(o, r.cur));
  const itemsSold = Math.round(sales.flatMap((o) => o.order_items ?? []).reduce((t, i) => t + i.quantity, 0));
  const spark = useMemo(() => {
    const [s, e] = r.cur;
    const n = period === 'day' ? 8 : period === 'week' ? 7 : period === 'month' ? 10 : 13;
    const step = (e.getTime() - s.getTime()) / n;
    return Array.from({ length: n }, (_, i) => sf.reduce((t, o) => t + revenueReceived(o, new Date(s.getTime() + i * step), new Date(s.getTime() + (i + 1) * step)), 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.data, period]);

  const top = useMemo(() => topProducts(sales, items.data ?? []), [sales, items.data]);
  const upcomingAway = (away.data ?? []).map((u) => u.date).filter((d) => d >= new Date().toISOString().slice(0, 10)).sort();
  const awayToday = upcomingAway[0] === new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  return (
    <div className="page">
      <header className="home-hero">
        <div>
          <p className="home-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="home-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          {profile?.business_name && <p className="muted">{profile.business_name}</p>}
        </div>
        <div className="btn-row">
          <Link to="/menu/new" className="btn btn-secondary">New listing</Link>
          <Link to="/orders/new" className="btn btn-primary">New order</Link>
        </div>
      </header>

      {profile && !profile.stripe_connect_onboarding_complete && (
        <Link to="/payouts" className="banner banner-info banner-link">
          <span><strong>Connect Direct Deposit</strong> — products only appear on your storefront once Stripe is connected.</span>
          <span aria-hidden>→</span>
        </Link>
      )}
      {upcomingAway.length > 0 && (
        <Link to="/schedule" className="banner banner-warn banner-link">
          <span>{awayToday ? 'You’re marked as unavailable today' : `Marked unavailable from ${formatDate(`${upcomingAway[0]}T12:00`, { weekday: 'short', month: 'short', day: 'numeric' })}`}{upcomingAway.length > 1 ? ` · ${upcomingAway.length} days coming up` : ''} — customers can’t pick those dates.</span>
          <span aria-hidden>→</span>
        </Link>
      )}
      {orders.error && <ErrorBanner message={orders.error} onRetry={orders.reload} />}

      <div className="attention">
        <Link to="/orders?filter=action" className={`att ${actionable.length ? 'hot' : ''}`}><span className="att-value">{orders.loading ? '–' : actionable.length}</span><span className="att-label">New orders</span></Link>
        <Link to="/orders?filter=unpaid" className="att"><span className="att-value">{orders.loading ? '–' : unpaid.length}</span><span className="att-label">Unpaid</span></Link>
        <Link to="/orders" className="att"><span className="att-value">{orders.loading ? '–' : due48.length}</span><span className="att-label">Due in 48h</span></Link>
      </div>

      <SetupChecklist userId={userId} items={items.data} />

      <section className="sales-card">
        <div className="sales-head">
          <div>
            <span className="sales-label">Storefront revenue · {r.label}</span>
            <div className="sales-value">
              {formatMoney(revenue)}
              {delta != null && <span className={`delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}%</span>}
            </div>
          </div>
          <div className="seg sm seg-dark">
            {(['day', 'week', 'month', '90'] as Period[]).map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p === '90' ? '90 days' : p[0].toUpperCase() + p.slice(1)}</button>)}
          </div>
        </div>
        <Sparkline values={spark} />
        <div className="sales-stats">
          <div><span>{sales.length}</span>Sales</div>
          <div><span>{formatMoney(sales.length ? revenue / sales.length : 0)}</span>Average sale</div>
          <div><span>{itemsSold}</span>Items sold</div>
          <Link to="/finances" className="sales-more">Full report →</Link>
        </div>
      </section>

      <div className="grid-2 gap-lg">
        <Card title="Needs your response" actions={<Link to="/orders?filter=action" className="small">View all</Link>}>
          {orders.loading ? <Spinner /> : actionable.length === 0 ? (
            <EmptyState title="You’re all caught up" body="New storefront orders and quote requests show up here." />
          ) : (
            <ul className="list">{actionable.slice(0, 6).map((o) => <OrderRow key={o.id} o={o} />)}</ul>
          )}
        </Card>

        <Card title={`In progress · ${foodInProgress.length}`} actions={<Link to="/orders" className="small">All orders</Link>}>
          {orders.loading ? <Spinner /> : foodInProgress.length === 0 ? (
            <EmptyState title="Nothing due this week" />
          ) : (
            <ul className="list">{foodInProgress.slice(0, 8).map((o) => <OrderRow key={o.id} o={o} />)}</ul>
          )}
        </Card>
      </div>

      <div className="grid-2 gap-lg">
        <Card title="What’s selling" actions={<span className="small muted">{r.label}</span>}>
          {!top.length ? <EmptyState title="No storefront sales yet" body="Your best sellers show up here." /> : (
            <ul className="list">
              {top.slice(0, 5).map((p, i) => (
                <li key={p.name} className="list-row">
                  <span className="rank">{i + 1}</span>
                  <span className="thumb sm">{p.item?.has_image ? <img src={menuImageURL(p.item)} alt="" loading="lazy" /> : <span className="thumb-empty">{p.name[0]}</span>}</span>
                  <span className="grow">
                    <span className="row-title">{p.name}</span>
                    <span className="row-sub">{p.units} sold{p.item && p.item.listing_kind !== 'digital' && p.item.listing_kind !== 'custom' ? ` · ${p.item.available_qty_today} left` : ''}</span>
                  </span>
                  <span className="row-amount">{formatMoney(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {toShip.length > 0 ? (
          <Card title={`Ship this week · ${toShip.length}`}>
            <ul className="list">{toShip.slice(0, 6).map((o) => <OrderRow key={o.id} o={o} />)}</ul>
          </Card>
        ) : (
          <Card title="Today’s baking tasks" actions={<Link to="/schedule" className="small">Open schedule</Link>}>
            {tasks.loading ? <Spinner /> : todaysTasks.length === 0 ? <EmptyState title="No tasks for today" /> : (
              <ul className="list">
                {todaysTasks.map((t) => (
                  <li key={t.id} className="list-row"><span className="dot" data-color={t.color_name} /><span className="grow">{t.title}</span></li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      {toShip.length > 0 && todaysTasks.length > 0 && (
        <Card title="Today’s baking tasks" actions={<Link to="/schedule" className="small">Open schedule</Link>}>
          <ul className="list">
            {todaysTasks.map((t) => <li key={t.id} className="list-row"><span className="dot" data-color={t.color_name} /><span className="grow">{t.title}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function topProducts(orders: Order[], items: MenuItemFull[]) {
  const byId = new Map(items.map((m) => [m.id.toLowerCase(), m]));
  const map = new Map<string, { name: string; units: number; revenue: number; item?: MenuItemFull }>();
  for (const o of orders) for (const i of o.order_items ?? []) {
    const item = i.menu_item_id ? byId.get(i.menu_item_id.toLowerCase()) : undefined;
    const key = (item?.name ?? i.custom_name ?? 'Item').trim();
    const cur = map.get(key) ?? { name: key, units: 0, revenue: 0, item };
    cur.units += i.quantity; cur.revenue += i.quantity * i.price_per_unit;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 100, h = 36;
  const pts = values.map((v, i) => [values.length > 1 ? (i / (values.length - 1)) * w : w / 2, h - (v / max) * (h - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs><linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#sparkfill)" />
      <path d={d} fill="none" stroke="#fff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** WebShopSheet readiness: logo, header, about, pickup, something to sell. */
function SetupChecklist({ userId, items }: { userId: string; items: MenuItemFull[] | undefined }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<{ logo: boolean; header: boolean; about: boolean; pickup: boolean; links: number } | null>(null);
  const [hidden, setHidden] = usePref<'0' | '1'>('bakeri.home.setupHidden', '0');

  useEffect(() => {
    let alive = true;
    const uid = userId.toUpperCase();
    const exists = (bucket: string, path: string) => fetch(`${STORAGE_PUBLIC_URL}/${bucket}/${path}`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    Promise.all([
      exists('business-logos', `${uid}/logo.jpg`),
      exists('storefront-headers', `${uid}/header.jpg`),
      supabase.from('profiles').select('about_story, pickup_address, pickup_city').eq('id', userId).maybeSingle(),
      supabase.from('baker_links').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]).then(([logo, header, p, links]) => {
      if (!alive) return;
      const row: any = p.data ?? {};
      setState({ logo, header, about: !!row.about_story?.trim(), pickup: !!(row.pickup_address?.trim() || row.pickup_city?.trim()), links: links.count ?? 0 });
    });
    return () => { alive = false; };
  }, [userId]);

  if (!state || !items || hidden === '1') return null;
  const hasContent = items.some((m) => m.is_listed_in_marketplace || m.listing_kind === 'digital' || m.listing_kind === 'physical') || state.links > 0;
  const steps = [
    { done: state.logo, label: 'Add your logo', to: '/storefront' },
    { done: state.header, label: 'Add a header photo', to: '/storefront' },
    { done: state.about, label: 'Write your About section', to: '/storefront' },
    { done: state.pickup, label: 'Set your pickup details', to: '/shop-settings' },
    { done: hasContent, label: 'List something to sell or share', to: '/menu/new' },
  ];
  const done = steps.filter((s) => s.done).length;
  const link = profile?.profile_slug ? `https://bakeriapp.com/${profile.profile_slug}` : null;

  if (done === steps.length) {
    return link ? (
      <div className="share-strip">
        <span className="grow"><strong>Your storefront is live.</strong> <span className="muted">Share your link anywhere customers find you.</span></span>
        <code className="share-link">{link.replace('https://', '')}</code>
        <button className="btn btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Couldn’t copy', 'error'); } }}>Copy</button>
        <a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer">View ↗</a>
        <button className="icon-btn sm" aria-label="Hide" onClick={() => setHidden('1')}>×</button>
      </div>
    ) : null;
  }

  return (
    <Card title={`Finish your storefront · ${done} of ${steps.length}`} className="setup-card">
      <div className="progress"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="check-dot" aria-hidden>{s.done ? '✓' : ''}</span>
            {s.done ? <span>{s.label}</span> : <Link to={s.to}>{s.label} →</Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function OrderRow({ o }: { o: Order }) {
  const name = o.order_name || o.customer_name || o.buyer_display_name || 'Order';
  return (
    <li>
      <Link to={`/orders/${o.id}`} className="list-row link-row">
        <span className="grow">
          <span className="row-title">{name}</span>
          <span className="row-sub">
            {o.order_name && o.customer_name ? `${o.customer_name} · ` : ''}Due {formatDate(o.due_date, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </span>
        <span className="row-end">
          <Badge tone={statusTone(o)}>{statusLabel(o)}</Badge>
          <span className="row-amount">{formatMoney(effectiveTotal(o))}</span>
        </span>
      </Link>
    </li>
  );
}
