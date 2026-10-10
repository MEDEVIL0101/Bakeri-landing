import { useEffect, useState } from 'react';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import {
  loadShopSettings, saveItemShipping, savePickupAddress, saveShippingRules, saveSlug, slugify, slugSuggestions, slugTaken,
  type ShopSettings,
} from '../../lib/account';
import { listMenuItems } from '../../lib/menu';
import { parseNumber } from '../../lib/format';

export function ShopSettingsPage() {
  const userId = useUserId();
  const data = useLoad(() => loadShopSettings(userId), [userId]);
  if (data.loading && !data.data) return <div className="page page-narrow"><Spinner /></div>;
  if (!data.data) return <div className="page page-narrow"><ErrorBanner message={data.error ?? 'Couldn’t load your settings.'} onRetry={data.reload} /></div>;
  return (
    <div className="page page-narrow">
      <PageHeader title="Shop settings" subtitle="Your storefront link, where customers pick up, and how shipping is charged." />
      <SlugCard userId={userId} s={data.data} onSaved={data.reload} />
      <PickupCard userId={userId} s={data.data} />
      <ShippingCard userId={userId} s={data.data} />
    </div>
  );
}

// ── Storefront link (EditStorefrontSlugSheet) ─────────────────────────────

function SlugCard({ userId, s, onSaved }: { userId: string; s: ShopSettings; onSaved: () => void }) {
  const { refreshProfile } = useAuth();
  const toast = useToast();
  const [raw, setRaw] = useState(s.profile_slug);
  const [state, setState] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slug = slugify(raw);

  useEffect(() => {
    setErr(null);
    if (slug.length < 3 || slug === s.profile_slug) { setState('idle'); setSuggestions([]); return; }
    setState('checking');
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const taken = await slugTaken(userId, slug);
        if (!alive) return;
        setState(taken ? 'taken' : 'available');
        setSuggestions(taken ? await slugSuggestions(userId, slug, s.pickup_city, s.pickup_province) : []);
      } catch { if (alive) setState('idle'); }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [slug, s.profile_slug, s.pickup_city, s.pickup_province, userId]);

  return (
    <Card title="Storefront link">
      <Field label="Your link" hint="Letters, numbers, and hyphens only — this is the link you share with customers.">
        <div className="prefix-input">
          <span>bakeriapp.com/</span>
          <input className="input" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} autoCapitalize="none" />
        </div>
      </Field>
      {state === 'checking' && <p className="small muted">Checking…</p>}
      {state === 'available' && <p className="small ok-text">✓ bakeriapp.com/{slug} is available</p>}
      {state === 'taken' && (
        <div className="stack">
          <p className="small field-error">That link is already taken.</p>
          {suggestions.length > 0 && (
            <div className="chips">{suggestions.map((x) => <button key={x} type="button" className="chip chip-btn" onClick={() => setRaw(x)}>{x}</button>)}</div>
          )}
        </div>
      )}
      {err && <ErrorBanner message={err} />}
      {slug !== s.profile_slug && (
        <div className="btn-row">
          <Button disabled={slug.length < 3 || state === 'taken' || state === 'checking'} loading={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await saveSlug(userId, slug); await refreshProfile(); toast('Link saved'); onSaved(); }
            catch (e: any) { setErr(e.message); if (e.code === '23505') setState('taken'); }
            setBusy(false);
          }}>Save link</Button>
          <span className="small muted">Your old link stops working once you change it.</span>
        </div>
      )}
    </Card>
  );
}

// ── Pickup address ────────────────────────────────────────────────────────

function PickupCard({ userId, s }: { userId: string; s: ShopSettings }) {
  const { refreshProfile } = useAuth();
  const toast = useToast();
  const [a, setA] = useState({ pickup_address: s.pickup_address, pickup_city: s.pickup_city, pickup_province: s.pickup_province, pickup_postal_code: s.pickup_postal_code });
  const [busy, setBusy] = useState(false);
  const dirty = a.pickup_address !== s.pickup_address || a.pickup_city !== s.pickup_city || a.pickup_province !== s.pickup_province || a.pickup_postal_code !== s.pickup_postal_code;
  return (
    <Card title="Pickup address">
      <p className="small muted">Customers see this after they order, so they know where to collect. Food listings need a pickup address before they can go on your storefront.</p>
      <Field label="Street address"><Input value={a.pickup_address} autoComplete="street-address" onChange={(e) => setA({ ...a, pickup_address: e.target.value })} placeholder="123 Main St" /></Field>
      <div className="grid-3">
        <Field label="City"><Input value={a.pickup_city} autoComplete="address-level2" onChange={(e) => setA({ ...a, pickup_city: e.target.value })} /></Field>
        <Field label="State / province"><Input value={a.pickup_province} autoComplete="address-level1" onChange={(e) => setA({ ...a, pickup_province: e.target.value })} /></Field>
        <Field label="ZIP / postal code"><Input value={a.pickup_postal_code} autoComplete="postal-code" onChange={(e) => setA({ ...a, pickup_postal_code: e.target.value })} /></Field>
      </div>
      {dirty && <div><Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await savePickupAddress(userId, a); await refreshProfile(); toast('Pickup address saved'); Object.assign(s, a); } catch (e: any) { toast(e.message, 'error'); }
        setBusy(false);
      }}>Save address</Button></div>}
      <p className="small muted">Pickup hours and notes are edited in Storefront → Pickup hours.</p>
    </Card>
  );
}

// ── Shipping (WebShopShippingSheet) ───────────────────────────────────────

function ShippingCard({ userId, s }: { userId: string; s: ShopSettings }) {
  const toast = useToast();
  const items = useLoad(() => listMenuItems(userId), [userId]);
  const physical = (items.data ?? []).filter((m) => m.listing_kind === 'physical');
  const [freeOver, setFreeOver] = useState(s.shipping_free_over_threshold);
  const [pct, setPct] = useState(s.shipping_additional_item_percent);
  const [fees, setFees] = useState<Record<string, { shipping_fee: number; shipping_always_full_price: boolean }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFees(Object.fromEntries(physical.map((m) => [m.id, { shipping_fee: Number(m.shipping_fee ?? 0), shipping_always_full_price: !!m.shipping_always_full_price }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data]);

  const changedItems = physical.filter((m) => fees[m.id] && (fees[m.id].shipping_fee !== Number(m.shipping_fee ?? 0) || fees[m.id].shipping_always_full_price !== !!m.shipping_always_full_price));
  const dirty = freeOver !== s.shipping_free_over_threshold || pct !== s.shipping_additional_item_percent || changedItems.length > 0;

  return (
    <Card title="Shipping">
      <h3 className="h3">Item shipping fees</h3>
      {items.loading && !items.data ? <Spinner /> : !physical.length ? (
        <p className="small muted">You don’t have any “ships to you” listings yet. Add one in Menu &amp; Listings and its shipping fee will show up here.</p>
      ) : (
        <ul className="list">
          {physical.map((m) => (
            <li key={m.id} className="list-row ship-row">
              <span className="grow row-title">{m.name}</span>
              <div className="money-input"><span>$</span>
                <input className="input w-num" type="number" min="0" step="0.01" value={fees[m.id]?.shipping_fee || ''} placeholder="0.00"
                  onChange={(e) => setFees({ ...fees, [m.id]: { ...fees[m.id], shipping_fee: parseNumber(e.target.value) } })} />
              </div>
              <label className="check small"><input type="checkbox" checked={!!fees[m.id]?.shipping_always_full_price}
                onChange={(e) => setFees({ ...fees, [m.id]: { ...fees[m.id], shipping_always_full_price: e.target.checked } })} />Always full price</label>
            </li>
          ))}
        </ul>
      )}
      <h3 className="h3">Combined orders</h3>
      <div className="grid-2">
        <Field label="Free shipping over" hint={freeOver > 0 ? `Shipping is waived once ship-to-you items total $${freeOver.toFixed(2)} or more.` : '0 means never free.'}>
          <div className="money-input"><span>$</span><Input type="number" min="0" step="0.01" value={freeOver || ''} placeholder="0.00" onChange={(e) => setFreeOver(parseNumber(e.target.value))} /></div>
        </Field>
        <Field label="Each additional item ships at" hint="The item with the highest fee is always charged in full; every other item ships at this % of its own fee.">
          <div className="money-input suffix"><Input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(parseNumber(e.target.value))} /><span>%</span></div>
        </Field>
      </div>
      <p className="small muted">Items marked “Always full price” are never discounted when combined.</p>
      {dirty && <div><Button loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await saveShippingRules(userId, freeOver, pct);
          await saveItemShipping(changedItems.map((m) => ({ id: m.id, ...fees[m.id] })));
          Object.assign(s, { shipping_free_over_threshold: freeOver, shipping_additional_item_percent: pct });
          toast('Shipping saved'); items.reload();
        } catch (e: any) { toast(e.message, 'error'); }
        setBusy(false);
      }}>Save shipping</Button></div>}
    </Card>
  );
}
