import { useState } from 'react';
import { useUserId } from '../../auth/AuthProvider';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, Textarea, Toggle, useLoad, useToast } from '../../components/ui';
import {
  blankPromotion, deletePromotion, listPromotions, promoStatus, savePromotion, setPromotionActive, type PromoStatus, type Promotion,
} from '../../lib/promotions';
import { listMenuItems, menuImageURL, type MenuItemFull } from '../../lib/menu';
import { formatMoney, fromLocalInput, toDateTimeInput } from '../../lib/format';

const GROUPS: { status: PromoStatus; title: string; tone: 'green' | 'blue' | 'neutral' | 'gold' }[] = [
  { status: 'active', title: 'Active', tone: 'green' },
  { status: 'scheduled', title: 'Scheduled', tone: 'blue' },
  { status: 'paused', title: 'Paused', tone: 'gold' },
  { status: 'ended', title: 'Ended', tone: 'neutral' },
];

/** Mirrors iOS PromotionsView: percent-off sales, optional code, dates, banner. */
export function PromotionsPage() {
  const userId = useUserId();
  const toast = useToast();
  const promos = useLoad(() => listPromotions(userId), [userId]);
  const items = useLoad(() => listMenuItems(userId), [userId]);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const eligible = (items.data ?? []).filter((m) => m.is_listed_in_marketplace && m.listing_kind !== 'custom');

  return (
    <div className="page">
      <PageHeader title="Promotions" subtitle="Run a percent-off sale on your whole shop or a few items."
        actions={<Button onClick={() => setEditing(blankPromotion())}>New promotion</Button>} />
      {promos.error && <ErrorBanner message={promos.error} onRetry={promos.reload} />}
      {promos.loading && !promos.data ? <Spinner /> : !promos.data?.length ? (
        <Card>
          <EmptyState title="No promotions yet"
            body="Run a percent-off sale on your whole shop or a few items — with an optional code and a start and end date."
            action={<Button onClick={() => setEditing(blankPromotion())}>Start a promotion</Button>} />
        </Card>
      ) : GROUPS.map((g) => {
        const list = promos.data!.filter((p) => promoStatus(p) === g.status);
        if (!list.length) return null;
        return (
          <section key={g.status} className="stack">
            <h2 className="h3">{g.title}</h2>
            <div className="tile-grid">
              {list.map((p) => (
                <div key={p.id} className={`promo-tile ${g.status}`}>
                  <button className="promo-main" onClick={() => setEditing(p)}>
                    <span className="promo-pct">{Math.round(p.discount_value)}%<small>off</small></span>
                    <span className="grow">
                      <span className="row-title">{p.name || 'Untitled promotion'}</span>
                      <span className="small muted">{describe(p, items.data ?? [])}</span>
                      <span className="small muted">{windowText(p)}</span>
                    </span>
                  </button>
                  <div className="promo-foot">
                    {p.code ? <span className="code-chip">{p.code}{p.code_max_redemptions ? ` · ${p.code_redemption_count}/${p.code_max_redemptions}` : p.code_redemption_count ? ` · ${p.code_redemption_count} used` : ''}</span> : <Badge tone="neutral">Automatic</Badge>}
                    <span className="grow" />
                    {g.status !== 'ended' && (
                      <input type="checkbox" className="switch" checked={p.is_active} aria-label={p.is_active ? 'Pause promotion' : 'Resume promotion'}
                        onChange={async (e) => { try { await setPromotionActive(p.id, e.target.checked); promos.reload(); } catch (err: any) { toast(err.message, 'error'); } }} />
                    )}
                    <button className="icon-btn sm" aria-label="Delete promotion" onClick={() => setDeleting(p)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <PromoEditor userId={userId} initial={editing} eligible={eligible} isNew={!promos.data?.some((p) => p.id === editing.id)}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Promotion saved'); promos.reload(); }} />
      )}
      {deleting && (
        <ConfirmModal title={`Delete “${deleting.name || 'this promotion'}”?`} danger confirmLabel="Delete"
          body="It stops applying straight away. Orders that already used it keep their discount."
          onClose={() => setDeleting(null)} onConfirm={async () => { await deletePromotion(deleting.id); promos.reload(); }} />
      )}
    </div>
  );
}

function describe(p: Promotion, items: MenuItemFull[]): string {
  if (p.scope === 'site_wide') return 'Whole shop';
  if (p.scope === 'category') return 'Selected categories';
  const names = items.filter((m) => p.listing_ids.some((id) => id.toLowerCase() === m.id.toLowerCase())).map((m) => m.name);
  return names.length ? (names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')) : `${p.listing_ids.length} items`;
}

function windowText(p: Promotion): string {
  const f = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (p.starts_at && p.ends_at) return `${f(p.starts_at)} – ${f(p.ends_at)}`;
  if (p.ends_at) return `Until ${f(p.ends_at)}`;
  if (p.starts_at) return `From ${f(p.starts_at)}`;
  return 'Runs until you pause it';
}

function PromoEditor({ userId, initial, eligible, isNew, onClose, onSaved }: {
  userId: string; initial: Promotion; eligible: MenuItemFull[]; isNew: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [p, setP] = useState<Promotion>(initial);
  const [startsNow, setStartsNow] = useState(!initial.starts_at);
  const [start, setStart] = useState(toDateTimeInput(initial.starts_at ?? new Date().toISOString()));
  const [hasEnd, setHasEnd] = useState(!!initial.ends_at);
  const [end, setEnd] = useState(toDateTimeInput(initial.ends_at ?? new Date(Date.now() + 7 * 86400_000).toISOString()));
  const [requiresCode, setRequiresCode] = useState(!!initial.code);
  const [limit, setLimit] = useState(initial.code_max_redemptions != null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Promotion>) => setP((x) => ({ ...x, ...patch }));

  const startISO = startsNow ? null : fromLocalInput(start);
  const endISO = hasEnd ? fromLocalInput(end) : null;
  const canSave = p.name.trim() && p.discount_value >= 1 && p.discount_value <= 100
    && (p.scope !== 'listing' || p.listing_ids.length > 0)
    && (!requiresCode || (p.code ?? '').trim())
    && (!endISO || Date.parse(endISO) > (startISO ? Date.parse(startISO) : Date.now()));

  const sample = eligible.find((m) => p.scope === 'site_wide' || p.listing_ids.some((id) => id.toLowerCase() === m.id.toLowerCase()));
  const samplePrice = sample ? (sample.marketplace_price_from > 0 ? sample.marketplace_price_from : sample.default_price) : 24;

  return (
    <Modal title={isNew ? 'New promotion' : 'Edit promotion'} wide onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!canSave} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await savePromotion(userId, {
              ...p, starts_at: startISO, ends_at: endISO,
              code: requiresCode ? (p.code ?? '').trim().toUpperCase() || null : null,
              code_max_redemptions: requiresCode && limit ? p.code_max_redemptions : null,
              listing_ids: p.scope === 'listing' ? p.listing_ids : [],
            });
            onSaved();
          } catch (e: any) { setErr(e.message?.includes('duplicate') ? 'You already have a promotion with that code.' : e.message); setBusy(false); }
        }}>Save</Button>
      </>}>
      <div className="promo-editor">
        <div className="stack">
          <Field label="Name"><Input value={p.name} placeholder="e.g. Black Friday" onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
          <Field label="Discount" hint="Custom (quote-priced) items are never discounted.">
            <div className="pct-row">
              <input type="range" min={1} max={100} value={p.discount_value} onChange={(e) => set({ discount_value: Number(e.target.value) })} />
              <div className="money-input suffix"><Input className="w-num" type="number" min={1} max={100} value={p.discount_value} onChange={(e) => set({ discount_value: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} /><span>%</span></div>
            </div>
          </Field>
          <Field label="Applies to">
            <div className="seg">
              <button type="button" className={p.scope === 'site_wide' ? 'active' : ''} onClick={() => set({ scope: 'site_wide' })}>Whole shop</button>
              <button type="button" className={p.scope === 'listing' ? 'active' : ''} onClick={() => set({ scope: 'listing' })}>Choose items</button>
            </div>
          </Field>
          {p.scope === 'listing' && (
            !eligible.length ? <p className="small muted">No eligible listings — custom items can’t go on sale.</p> : (
              <div className="pick-grid">
                {eligible.map((m) => {
                  const on = p.listing_ids.some((id) => id.toLowerCase() === m.id.toLowerCase());
                  return (
                    <button type="button" key={m.id} className={`pick ${on ? 'on' : ''}`}
                      onClick={() => set({ listing_ids: on ? p.listing_ids.filter((id) => id.toLowerCase() !== m.id.toLowerCase()) : [...p.listing_ids, m.id] })}>
                      <span className="pick-thumb">{m.has_image ? <img src={menuImageURL(m)} alt="" loading="lazy" /> : m.name[0]}</span>
                      <span className="ellipsis">{m.name}</span>
                      <span className="pick-check">{on ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )
          )}
          <h3 className="h3">When</h3>
          <Toggle checked={startsNow} onChange={setStartsNow} label="Start now" />
          {!startsNow && <Field label="Starts"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
          <Toggle checked={hasEnd} onChange={setHasEnd} label="Set an end date" hint={hasEnd ? undefined : 'Runs until you pause it.'} />
          {hasEnd && <Field label="Ends"><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>}
          <h3 className="h3">Code</h3>
          <Toggle checked={requiresCode} onChange={setRequiresCode} label="Require a code at checkout" hint={requiresCode ? undefined : 'Off = an automatic sale that shows a struck-through price on your storefront.'} />
          {requiresCode && (
            <>
              <Input value={p.code ?? ''} placeholder="WELCOME10" className="code-input" onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, '') })} />
              <Toggle checked={limit} onChange={setLimit} label="Limit total uses" />
              {limit && <Field label="Max redemptions"><Input className="w-num" type="number" min={1} value={p.code_max_redemptions ?? ''} placeholder="100" onChange={(e) => set({ code_max_redemptions: Number(e.target.value) || null })} /></Field>}
            </>
          )}
          <h3 className="h3">Storefront banner</h3>
          <Textarea rows={2} value={p.banner_text} placeholder="e.g. 🎃 20% off everything through Sunday" onChange={(e) => set({ banner_text: e.target.value })} />
          <p className="small muted">Optional. Shows as a coloured strip above your storefront’s header photo while this promotion is active.</p>
          {err && <ErrorBanner message={err} />}
        </div>
        <aside className="promo-preview">
          <span className="fb-preview-label">Preview</span>
          {p.banner_text.trim() && <div className="promo-banner">{p.banner_text}</div>}
          <div className="promo-card-preview">
            <div className="promo-img">{sample?.has_image ? <img src={menuImageURL(sample)} alt="" /> : null}<span className="sale-tag">{Math.round(p.discount_value)}% off</span></div>
            <div className="row-title">{sample?.name ?? 'Your item'}</div>
            <div>
              {requiresCode ? <span>{formatMoney(samplePrice)} <span className="small muted">· code {p.code || '…'} at checkout</span></span>
                : <><span className="strike">{formatMoney(samplePrice)}</span> <strong>{formatMoney(samplePrice * (1 - p.discount_value / 100))}</strong></>}
            </div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
