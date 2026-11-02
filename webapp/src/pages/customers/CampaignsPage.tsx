import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { effectiveTier } from '../../lib/plans';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Textarea, useLoad, useToast } from '../../components/ui';
import { CONTACT_SOURCES, deleteCampaign, listCampaigns, saveCampaignDraft, sendCampaign, sendCampaignTest } from '../../lib/data';
import { listMenuItems } from '../../lib/menu';
import { formatDate, formatDateTime } from '../../lib/format';
import {
  EMPTY_FILTER, campaignStats, describeFilter, isEmptyFilter, listCampaignSends, matches, pct,
  type Audience, type AudienceFilter, type CustomerProfile,
} from '../../lib/crm';
import type { Campaign, CampaignSend } from '../../lib/types';
import { useCrm } from './useCrm';

// Email campaigns are a Pro feature (Harvey 2026-10-30). Starter vendors
// still collect their mailing list; send-baker-campaign enforces the same rule.
function ProGate({ children }: { children: React.ReactNode }) {
  const { plan } = useAuth();
  if (effectiveTier(plan) === 'pro') return <>{children}</>;
  return (
    <div className="page">
      <PageHeader title="Email Campaigns" />
      <Card>
        <EmptyState title="Email campaigns are part of Pro" body="Send launches, drops and sales to the customers you choose. Your customers and mailing list keep being collected on every plan." />
        <div className="btn-row" style={{ justifyContent: 'center' }}><Link to="/plan" className="btn btn-primary">See Pro</Link></div>
      </Card>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────

export function CampaignsPage() {
  return <ProGate><CampaignsList /></ProGate>;
}

function CampaignsList() {
  const userId = useUserId();
  const navigate = useNavigate();
  const data = useLoad(async () => {
    const [campaigns, sends] = await Promise.all([listCampaigns(userId), listCampaignSends()]);
    return { campaigns, sends };
  }, [userId]);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const sendsBy = useMemo(() => {
    const m = new Map<string, CampaignSend[]>();
    for (const s of data.data?.sends ?? []) (m.get(s.campaign_id) ?? m.set(s.campaign_id, []).get(s.campaign_id)!).push(s);
    return m;
  }, [data.data]);

  const sent = (data.data?.campaigns ?? []).filter((c) => c.status !== 'draft');
  const drafts = (data.data?.campaigns ?? []).filter((c) => c.status === 'draft');

  return (
    <div className="page">
      <PageHeader
        title="Email Campaigns"
        subtitle="Choose exactly who hears from you, and see who opened and clicked."
        actions={<Button data-icon="plus" onClick={() => navigate('/campaigns/new')}>New email</Button>}
      />
      {data.error && <ErrorBanner message={data.error} onRetry={data.reload} />}
      {data.loading && !data.data ? <Spinner /> : !data.data?.campaigns.length ? (
        <Card>
          <EmptyState title="No campaigns yet" body="Announce a new menu, a pre-order drop or a holiday special, to everyone or just the customers it suits."
            action={<Button onClick={() => navigate('/campaigns/new')}>Write your first email</Button>} />
        </Card>
      ) : (
        <div className="stack-lg">
          {drafts.length > 0 && (
            <Card title="Drafts">
              <ul className="list">
                {drafts.map((c) => (
                  <li key={c.id} className="list-row">
                    <Link to={`/campaigns/${c.id}/edit`} className="grow">
                      <span className="row-title">{c.subject || '(No subject)'}</span>
                      <span className="row-sub">{c.audience?.label ?? 'Everyone on your mailing list'} · edited {formatDateTime(c.updated_at)}</span>
                    </Link>
                    <span className="btn-row">
                      <Button variant="secondary" onClick={() => navigate(`/campaigns/${c.id}/edit`)}>Edit</Button>
                      <button className="icon-btn sm" aria-label="Delete draft" onClick={() => setDeleting(c)}>×</button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {sent.length > 0 && (
            <Card title="Sent">
              <ul className="list">
                {sent.map((c) => {
                  const st = campaignStats(sendsBy.get(c.id) ?? []);
                  return (
                    <li key={c.id} className="list-row row-link" onClick={() => navigate(`/campaigns/${c.id}`)}>
                      <span className="grow">
                        <Link className="row-title" to={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.subject || '(No subject)'}</Link>
                        <span className="row-sub">
                          {c.status === 'sending' ? 'Sending…' : `Sent ${formatDate(c.sent_at)} to ${st.sent || c.recipient_count}`}
                          {st.sent > 0 && <> · {pct(st.openRate)} opened · {st.clicked} click{st.clicked === 1 ? '' : 's'}</>}
                        </span>
                      </span>
                      {c.status === 'failed' ? <Badge tone="red">Failed</Badge> : c.status === 'sending' ? <Badge tone="gold">Sending</Badge> : <Badge tone="green">Sent</Badge>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      )}
      {deleting && (
        <ConfirmModal title="Delete this draft?" confirmLabel="Delete" danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteCampaign(deleting.id); data.reload(); }} />
      )}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────

export function CampaignEditorPage() {
  return <ProGate><CampaignEditor /></ProGate>;
}

type Mode = 'filter' | 'picked';

function CampaignEditor() {
  const { id } = useParams();
  const userId = useUserId();
  const crm = useCrm(userId);
  const existing = useLoad(async () => (id ? (await listCampaigns(userId)).find((c) => c.id === id) ?? null : null), [id, userId]);

  if (crm.error) return <div className="page"><ErrorBanner message={crm.error} onRetry={crm.reload} /></div>;
  if (!crm.data || existing.loading) return <div className="page"><Spinner label="Loading your customers…" /></div>;
  if (id && !existing.data) return <div className="page"><EmptyState title="Campaign not found" action={<Link to="/campaigns" className="btn btn-secondary">Back to campaigns</Link>} /></div>;
  if (existing.data && existing.data.status !== 'draft') return <CampaignReport campaign={existing.data} />;
  return <EditorForm userId={userId} campaign={existing.data ?? null} crm={crm.data} />;
}

function EditorForm({ userId, campaign, crm }: {
  userId: string;
  campaign: Campaign | null;
  crm: NonNullable<ReturnType<typeof useCrm>['data']>;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const menu = useLoad(() => listMenuItems(userId), [userId]);

  // Prefilled people from the Customers page or a report ("?to=id,id").
  const preset = (params.get('to') ?? '').split(',').filter(Boolean);
  const saved = campaign?.audience ?? null;
  const [mode, setMode] = useState<Mode>(preset.length ? 'picked' : saved?.mode ?? 'filter');
  const [filter, setFilter] = useState<AudienceFilter>({ ...EMPTY_FILTER, ...(saved?.filter ?? {}) });
  const [excluded, setExcluded] = useState<Set<string>>(new Set(saved?.excluded ?? []));
  const [added, setAdded] = useState<Set<string>>(new Set(preset.length ? preset : saved?.added ?? []));

  const [subject, setSubject] = useState(campaign?.subject ?? params.get('subject') ?? '');
  const [body, setBody] = useState(campaign?.body_text ?? '');
  const [ctaMode, setCtaMode] = useState<'none' | 'listing' | 'url'>(campaign?.cta_listing_id ? 'listing' : campaign?.cta_url ? 'url' : 'none');
  const [ctaLabel, setCtaLabel] = useState(campaign?.cta_label ?? '');
  const [ctaURL, setCtaURL] = useState(campaign?.cta_url ?? '');
  const [ctaListing, setCtaListing] = useState(campaign?.cta_listing_id ?? '');
  const [draftId, setDraftId] = useState<string | undefined>(campaign?.id);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const subscribed = useMemo(() => [...crm.profiles.values()].filter((p) => !p.contact.unsubscribed_at), [crm]);
  const unsubscribedCount = crm.contacts.length - subscribed.length;
  const productLabel = (k: string) => crm.catalog.find((p) => p.key === k)?.label ?? 'a product';
  const sourceLabel = (s: string) => (CONTACT_SOURCES[s] ?? s).toLowerCase();

  const isIn = (p: CustomerProfile) => mode === 'picked'
    ? added.has(p.contact.id)
    : (matches(p, filter) && !excluded.has(p.contact.id)) || added.has(p.contact.id);
  const recipients = subscribed.filter(isIn);
  const label = mode === 'picked'
    ? `${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} you picked`
    : describeFilter(filter, productLabel, sourceLabel) + (excluded.size || added.size ? ' (adjusted by hand)' : '');

  function toggle(p: CustomerProfile) {
    const id = p.contact.id;
    if (mode === 'picked' || !matches(p, filter)) {
      setAdded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    } else {
      setExcluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
  }
  function setAll(ps: CustomerProfile[], on: boolean) {
    for (const p of ps) if (isIn(p) !== on) toggle(p);
  }

  function audience(): Audience {
    return {
      mode, filter, excluded: [...excluded], added: [...added],
      contact_ids: recipients.map((p) => p.contact.id), label,
    };
  }

  async function save(): Promise<string | null> {
    if (!subject.trim() || !body.trim()) { setErr('Add a subject and a message.'); return null; }
    if (ctaMode === 'url' && !/^https?:\/\//i.test(ctaURL.trim())) { setErr('The button link must start with https://'); return null; }
    if (ctaMode === 'listing' && !ctaListing) { setErr('Choose the listing the button opens.'); return null; }
    setErr(null);
    const id = await saveCampaignDraft(userId, {
      id: draftId,
      subject: subject.trim(),
      body_text: body,
      cta_label: ctaMode === 'none' ? null : ctaLabel.trim() || (ctaMode === 'listing' ? 'Order now' : 'Learn more'),
      cta_url: ctaMode === 'url' ? ctaURL.trim() : null,
      cta_listing_id: ctaMode === 'listing' ? ctaListing || null : null,
      audience: audience(),
    });
    setDraftId(id);
    return id;
  }

  return (
    <div className="page">
      <PageHeader back={<Link to="/campaigns" className="back-link">Campaigns</Link>} title={campaign ? 'Edit email' : 'New email'} />
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="1. Who it’s for">
            <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
              <button className={mode === 'filter' ? 'active' : ''} onClick={() => setMode('filter')}>Choose by filters</button>
              <button className={mode === 'picked' ? 'active' : ''} onClick={() => setMode('picked')}>Pick people</button>
            </div>
            {mode === 'filter' && (
              <FilterBuilder filter={filter} onChange={setFilter} catalog={crm.catalog} tags={crm.tags} />
            )}
            <PeoplePicker profiles={subscribed} isIn={isIn} toggle={toggle} setAll={setAll} mode={mode} filter={filter} />
            {unsubscribedCount > 0 && (
              <p className="small muted">{unsubscribedCount} unsubscribed {unsubscribedCount === 1 ? 'customer isn’t' : 'customers aren’t'} shown and never get campaigns.</p>
            )}
          </Card>

          <Card title="2. Your email">
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Fall menu is here 🍂" /></Field>
            <Field label="Message" hint="A blank line starts a new paragraph."><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <div className="grid-2">
              <Field label="Button">
                <Select value={ctaMode} onChange={(e) => setCtaMode(e.target.value as typeof ctaMode)}>
                  <option value="none">No button</option>
                  <option value="listing">Opens one of my listings</option>
                  <option value="url">Opens a web link</option>
                </Select>
              </Field>
              {ctaMode !== 'none' && <Field label="Button text"><Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder={ctaMode === 'listing' ? 'Order now' : 'Learn more'} /></Field>}
            </div>
            {ctaMode === 'listing' && (
              <Field label="Listing">
                <Select value={ctaListing} onChange={(e) => setCtaListing(e.target.value)}>
                  <option value="">Choose…</option>
                  {(menu.data ?? []).filter((m) => m.is_listed_in_marketplace).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
            )}
            {ctaMode === 'url' && <Field label="Link"><Input type="url" value={ctaURL} onChange={(e) => setCtaURL(e.target.value)} placeholder="https://" /></Field>}
          </Card>
        </div>

        <div className="stack-lg camp-side">
          <Card title="Ready to send">
            <div className="camp-count"><b>{recipients.length}</b> {recipients.length === 1 ? 'person' : 'people'}</div>
            <p className="small muted" style={{ marginTop: 4 }}>{label}</p>
            {err && <ErrorBanner message={err} />}
            <div className="stack-sm" style={{ marginTop: 14 }}>
              <Button disabled={!recipients.length || !!busy} onClick={async () => { if (await save().catch((e) => { setErr(e.message); return null; })) setConfirming(true); }}>
                Send to {recipients.length} {recipients.length === 1 ? 'person' : 'people'}…
              </Button>
              <Button variant="secondary" loading={busy === 'test'} disabled={!!busy} onClick={async () => {
                setBusy('test');
                try { const id = await save(); if (id) toast(`Test sent to ${await sendCampaignTest(id)}`); }
                catch (e: any) { setErr(e.message); }
                setBusy(null);
              }}>Send a test to me</Button>
              <Button variant="ghost" loading={busy === 'save'} disabled={!!busy} onClick={async () => {
                setBusy('save');
                try { if (await save()) { toast('Draft saved'); navigate('/campaigns'); } } catch (e: any) { setErr(e.message); }
                setBusy(null);
              }}>Save draft</Button>
            </div>
          </Card>
          <p className="small muted">Every email has an unsubscribe link. Opens and clicks are tracked so you can see what worked.</p>
        </div>
      </div>

      {confirming && draftId && (
        <ConfirmModal
          title={`Send to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}?`}
          body={`“${subject.trim()}” goes out now to: ${label.charAt(0).toLowerCase() + label.slice(1)}. This can’t be undone.`}
          confirmLabel="Send now"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const r = await sendCampaign(draftId);
            toast(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}${r.failed ? ` (${r.failed} failed)` : ''}`);
            navigate(`/campaigns/${draftId}`);
          }}
        />
      )}
    </div>
  );
}

function FilterBuilder({ filter, onChange, catalog, tags }: {
  filter: AudienceFilter;
  onChange: (f: AudienceFilter) => void;
  catalog: { key: string; label: string; count: number }[];
  tags: string[];
}) {
  const set = <K extends keyof AudienceFilter>(k: K, v: AudienceFilter[K]) => onChange({ ...filter, [k]: v });
  const toggleIn = (k: 'products' | 'tags' | 'sources', v: string) =>
    set(k, filter[k].includes(v) ? filter[k].filter((x) => x !== v) : [...filter[k], v]);

  return (
    <div className="camp-filters">
      <p className="small muted" style={{ marginTop: 0 }}>Everyone on your mailing list, narrowed by any of these. Combine as many as you like.</p>
      <div className="grid-2">
        <Field label="Orders">
          <Select value={filter.ordered} onChange={(e) => set('ordered', e.target.value as AudienceFilter['ordered'])}>
            <option value="any">Anyone</option>
            <option value="yes">Has ordered</option>
            <option value="no">Never ordered</option>
          </Select>
        </Field>
        {filter.ordered === 'yes' ? (
          <Field label="At least">
            <Select value={String(filter.minOrders)} onChange={(e) => set('minOrders', Number(e.target.value))}>
              {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n === 1 ? '1 order' : `${n} orders`}</option>)}
            </Select>
          </Field>
        ) : <span />}
      </div>
      {filter.ordered !== 'no' && (
        <div className="grid-2">
          <Field label="Last order">
            <Select value={filter.lastOrder} onChange={(e) => set('lastOrder', e.target.value as AudienceFilter['lastOrder'])}>
              <option value="any">Any time</option>
              <option value="within">Within the last…</option>
              <option value="before">Not in the last…</option>
            </Select>
          </Field>
          {filter.lastOrder !== 'any' ? (
            <Field label="Days">
              <Select value={String(filter.lastOrderDays)} onChange={(e) => set('lastOrderDays', Number(e.target.value))}>
                {[7, 14, 30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>{n} days</option>)}
              </Select>
            </Field>
          ) : <span />}
        </div>
      )}
      {filter.ordered !== 'no' && catalog.length > 0 && (
        <Field label="Bought any of" hint={filter.products.length ? undefined : 'Pick products to reach people who ordered them.'}>
          <div className="chips">
            {catalog.slice(0, 30).map((p) => (
              <button key={p.key} type="button" className={`chip chip-btn ${filter.products.includes(p.key) ? 'on' : ''}`} onClick={() => toggleIn('products', p.key)}>
                {p.label}<span className="muted">{p.count}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
      {tags.length > 0 && (
        <Field label="Tagged">
          <div className="chips">
            {tags.map((t) => (
              <button key={t} type="button" className={`chip chip-btn ${filter.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleIn('tags', t)}>{t}</button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Joined from">
        <div className="chips">
          {Object.entries(CONTACT_SOURCES).map(([k, v]) => (
            <button key={k} type="button" className={`chip chip-btn ${filter.sources.includes(k) ? 'on' : ''}`} onClick={() => toggleIn('sources', k)}>{v}</button>
          ))}
        </div>
      </Field>
      <Field label="Earlier emails">
        <Select value={filter.engagement} onChange={(e) => set('engagement', e.target.value as AudienceFilter['engagement'])}>
          <option value="any">Anyone</option>
          <option value="opened">Opened one of my emails</option>
          <option value="clicked">Clicked in one of my emails</option>
          <option value="never_opened">Got emails but never opened one</option>
          <option value="never_emailed">Never emailed yet</option>
        </Select>
      </Field>
      {!isEmptyFilter(filter) && (
        <button type="button" className="link-btn small" onClick={() => onChange(EMPTY_FILTER)}>Clear filters</button>
      )}
    </div>
  );
}

function PeoplePicker({ profiles, isIn, toggle, setAll, mode, filter }: {
  profiles: CustomerProfile[];
  isIn: (p: CustomerProfile) => boolean;
  toggle: (p: CustomerProfile) => void;
  setAll: (ps: CustomerProfile[], on: boolean) => void;
  mode: Mode;
  filter: AudienceFilter;
}) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(mode === 'picked');
  const term = q.trim().toLowerCase();
  const visible = profiles
    .filter((p) => mode === 'picked' || showAll || term || isIn(p) || matches(p, filter))
    .filter((p) => !term || [p.contact.email, p.contact.name, ...(p.contact.tags ?? [])].some((v) => v?.toLowerCase().includes(term)))
    .sort((a, b) => Number(isIn(b)) - Number(isIn(a)) || (a.contact.name || a.contact.email).localeCompare(b.contact.name || b.contact.email));
  const shown = visible.slice(0, 200);
  const allOn = visible.length > 0 && visible.every(isIn);

  return (
    <div className="camp-people">
      <div className="toolbar" style={{ margin: '14px 0 8px' }}>
        <Input type="search" className="search" placeholder="Search people or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="btn-row">
          {mode === 'filter' && !term && (
            <button type="button" className="link-btn small" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Only matches' : 'Show everyone'}</button>
          )}
          <button type="button" className="link-btn small" disabled={!visible.length} onClick={() => setAll(visible, !allOn)}>{allOn ? 'Clear all' : 'Select all'}</button>
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="small muted">{mode === 'picked' ? 'Nobody matches that search.' : 'Nobody matches these filters yet.'}</p>
      ) : (
        <ul className="camp-list">
          {shown.map((p) => (
            <li key={p.contact.id}>
              <label className="check">
                <input type="checkbox" checked={isIn(p)} onChange={() => toggle(p)} />
                <span className="grow">
                  <span className="row-title">{p.contact.name || p.contact.email}</span>
                  <span className="small muted">
                    {p.contact.name ? `${p.contact.email} · ` : ''}
                    {p.orderCount ? `${p.orderCount} order${p.orderCount === 1 ? '' : 's'}, last ${formatDate(p.lastOrderAt)}` : 'No orders yet'}
                    {p.emailsSent ? ` · ${p.emailsSent} email${p.emailsSent === 1 ? '' : 's'}, ${p.emailsOpened} opened` : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {visible.length > shown.length && <p className="small muted">Showing 200 of {visible.length}. Search to find someone, or use Select all.</p>}
    </div>
  );
}

// ── Report ───────────────────────────────────────────────────────────────

function CampaignReport({ campaign }: { campaign: Campaign }) {
  const userId = useUserId();
  const navigate = useNavigate();
  const crm = useCrm(userId);
  const [show, setShow] = useState<'all' | 'opened' | 'unopened' | 'clicked' | 'failed'>('all');

  if (!crm.data) return <div className="page"><Spinner /></div>;
  const sends = crm.data.sends.filter((s) => s.campaign_id === campaign.id);
  const st = campaignStats(sends);
  const byId = new Map(crm.data.contacts.map((c) => [c.id, c]));
  const rows = sends.filter((s) =>
    show === 'all' ? true : show === 'opened' ? !!s.opened_at : show === 'unopened' ? s.status === 'sent' && !s.opened_at
      : show === 'clicked' ? !!s.clicked_at : s.status === 'failed');
  const unopened = sends.filter((s) => s.status === 'sent' && !s.opened_at && s.contact_id).map((s) => s.contact_id!);

  return (
    <div className="page">
      <PageHeader
        back={<Link to="/campaigns" className="back-link">Campaigns</Link>}
        title={campaign.subject || '(No subject)'}
        subtitle={`Sent ${formatDateTime(campaign.sent_at)} · ${campaign.audience?.label ?? 'Everyone on your mailing list'}`}
        actions={unopened.length > 0 ? (
          <Button variant="secondary" onClick={() => navigate(`/campaigns/new?to=${unopened.join(',')}&subject=${encodeURIComponent(campaign.subject)}`)}>
            Email the {unopened.length} who didn’t open
          </Button>
        ) : undefined}
      />
      <div className="metric-grid camp-tiles">
        <Tile label="Sent" value={String(st.sent)} sub={st.failed ? `${st.failed} couldn’t be delivered` : 'Delivered to their inbox'} />
        <Tile label="Opened" value={pct(st.openRate)} sub={`${st.opened} of ${st.sent} people`} />
        <Tile label="Clicked" value={pct(st.clickRate)} sub={campaign.cta_label ? `${st.clicked} tapped “${campaign.cta_label}”` : 'This email had no button'} />
        <Tile label="Clicks per opener" value={st.opened ? (st.clicked / st.opened).toFixed(2) : '—'} sub="How well the button worked" />
      </div>
      <Card title="Who got it" actions={
        <div className="pills">
          {([['all', 'All'], ['opened', 'Opened'], ['unopened', 'Didn’t open'], ['clicked', 'Clicked'], ['failed', 'Failed']] as const).map(([k, l]) => (
            <button key={k} className={`pill ${show === k ? 'active' : ''}`} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
      }>
        {rows.length === 0 ? <p className="small muted">Nobody here.</p> : (
          <div className="table-scroll"><table className="table">
            <thead><tr><th>Customer</th><th>Opened</th><th className="hide-sm">Clicked</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const c = s.contact_id ? byId.get(s.contact_id) : undefined;
                return (
                  <tr key={s.id}>
                    <td>
                      {c ? <Link className="row-title" to={`/customers/${c.id}`}>{c.name || c.email}</Link> : <span className="row-title">{s.email}</span>}
                      {c?.name && <div className="small muted">{c.email}</div>}
                    </td>
                    <td>{s.status === 'failed' ? <Badge tone="red">Failed</Badge> : s.opened_at ? <>{formatDateTime(s.opened_at)}{s.open_count > 1 && <span className="muted"> · {s.open_count}×</span>}</> : <span className="muted">Not yet</span>}</td>
                    <td className="hide-sm">{s.clicked_at ? <>{formatDateTime(s.clicked_at)}{s.click_count > 1 && <span className="muted"> · {s.click_count}×</span>}</> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="small muted">Opens are approximate: some email apps (like Apple Mail) load images for privacy, which can count as an open, and others block images so a real open isn’t seen. Clicks are exact.</p>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="metric static">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}
