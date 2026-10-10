import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Badge, EmptyState, ErrorBanner, Input, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import { kindLabel, listMenuItems, menuImageURL, reorderMenu, setListed, setStock, type MenuItemFull } from '../../lib/menu';
import { formatMoney } from '../../lib/format';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'listed', label: 'On storefront' },
  { key: 'hidden', label: 'Not listed' },
] as const;

export function MenuPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(() => listMenuItems(userId), [userId]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((m) => filter === 'all' || (filter === 'listed' ? m.is_listed_in_marketplace : !m.is_listed_in_marketplace))
      .filter((m) => !term || m.name.toLowerCase().includes(term) || m.category.toLowerCase().includes(term));
  }, [data, filter, q]);

  async function toggleListed(m: MenuItemFull) {
    const next = !m.is_listed_in_marketplace;
    if (next && m.listing_kind === 'custom' && !m.intake_form_id) {
      toast('Pick an order form for this custom listing before listing it.', 'error');
      return;
    }
    // Same rule as the editor: food needs a pickup address or delivery.
    if (next && m.listing_kind !== 'digital' && m.listing_kind !== 'physical' && !profile?.pickup_address?.trim() && !profile?.delivery_enabled) {
      toast('Add a pickup address or turn on delivery in the app before listing food items.', 'error');
      return;
    }
    setData((data ?? []).map((x) => (x.id === m.id ? { ...x, is_listed_in_marketplace: next } : x)));
    try {
      await setListed(m, next);
      toast(next ? `${m.name} is on your storefront` : `${m.name} is hidden`);
    } catch (e: any) {
      toast(e.message, 'error');
      reload();
    }
  }

  async function saveStock(m: MenuItemFull, value: string) {
    const qty = Math.max(0, Math.floor(Number(value) || 0));
    if (qty === m.available_qty_today) return;
    try { await setStock(m, qty); toast('Stock updated'); reload(); } catch (e: any) { toast(e.message, 'error'); }
  }

  async function move(m: MenuItemFull, dir: -1 | 1) {
    const list = [...(data ?? [])];
    const i = list.findIndex((x) => x.id === m.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setData(list.map((x, idx) => ({ ...x, sort_order: idx })));
    try { await reorderMenu(list); } catch (e: any) { toast(e.message, 'error'); reload(); }
  }

  const usesStock = (m: MenuItemFull) =>
    (m.listing_kind === 'ready_now' || m.listing_kind === 'preorder' || m.listing_kind === 'physical') && !m.has_variants;

  return (
    <div className="page">
      <PageHeader
        title="Menu & Listings"
        subtitle="Everything you sell. Listed items appear on your storefront straight away."
        actions={<Link to="/menu/new" className="btn btn-primary">New listing</Link>}
      />
      {profile && !profile.stripe_connect_onboarding_complete && (
        <div className="banner banner-info">Listed products stay hidden from customers until Direct Deposit is connected (Bakeri app → Settings → Banking &amp; Payments).</div>
      )}
      {profile?.storefront_listing_id && (
        <div className="banner banner-info">Your storefront is currently a single custom-order form, so other listings aren’t shown. Change this in the app’s storefront builder.</div>
      )}
      <div className="toolbar">
        <div className="pills">
          {FILTERS.map((f) => (
            <button key={f.key} className={`pill ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <Input type="search" className="search" placeholder="Search listings…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="card">
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={q ? 'No listings match' : 'No listings yet'} body={!q ? 'Add what you sell — baked goods, pre-orders, custom orders, products and downloads.' : undefined}
            action={!q && <Link to="/menu/new" className="btn btn-primary">New listing</Link>} />
        ) : (
          <ul className="list">
            {rows.map((m) => (
              <li key={m.id} className="list-row menu-row">
                {filter === 'all' && !q && (
                  <span className="reorder">
                    <button className="icon-btn sm" aria-label="Move up" onClick={() => move(m, -1)}>↑</button>
                    <button className="icon-btn sm" aria-label="Move down" onClick={() => move(m, 1)}>↓</button>
                  </span>
                )}
                <Link to={`/menu/${m.id}`} className="thumb">
                  {m.has_image ? <img src={menuImageURL(m)} alt="" loading="lazy" /> : <span className="thumb-empty">{m.name.slice(0, 1)}</span>}
                </Link>
                <Link to={`/menu/${m.id}`} className="grow">
                  <span className="row-title">{m.name}</span>
                  <span className="row-sub">
                    <Badge>{kindLabel(m.listing_kind)}</Badge> {m.category && <span>{m.category} · </span>}
                    {m.is_assorted_box || m.has_variants ? 'from ' : ''}{formatMoney(m.marketplace_price_from || m.default_price)}
                  </span>
                </Link>
                {usesStock(m) && (
                  <label className="stock">
                    <span className="small muted">{m.listing_kind === 'preorder' ? 'Max' : 'Stock'}</span>
                    <input key={m.available_qty_today} className="input w-num" type="number" min="0" defaultValue={m.available_qty_today}
                      onBlur={(e) => saveStock(m, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  </label>
                )}
                <label className="listed-toggle" title={m.is_listed_in_marketplace ? 'On your storefront' : 'Not listed'}>
                  <span className="small muted">{m.is_listed_in_marketplace ? 'Listed' : 'Hidden'}</span>
                  <input type="checkbox" className="switch" checked={m.is_listed_in_marketplace} onChange={() => toggleListed(m)} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
