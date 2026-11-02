import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, Input, PageHeader, Spinner, Textarea, Toggle, useLoad, useToast } from '../../components/ui';
import { CONTACT_SOURCES, deleteContact, listCampaigns, setContactNotes, setContactTags, setSubscribed } from '../../lib/data';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { effectiveTier } from '../../lib/plans';
import { effectiveTotal } from '../../lib/orders';
import type { CustomerProfile } from '../../lib/crm';
import type { Campaign } from '../../lib/types';
import { OrderRow } from '../Dashboard';
import { useCrm } from './useCrm';

/**
 * A customer's profile (mirrors the app's CustomerProfileView, plus the
 * outreach side added 2026-11-02): who they are, what they've ordered, the
 * emails they've had and what they did with them, tags and private notes,
 * and their whole journey with the shop in one timeline.
 */
export function CustomerProfilePage() {
  const { id } = useParams();
  const userId = useUserId();
  const navigate = useNavigate();
  const toast = useToast();
  const { plan } = useAuth();
  const crm = useCrm(userId);
  const campaigns = useLoad(() => listCampaigns(userId), [userId]);
  const [removing, setRemoving] = useState(false);

  if (crm.loading && !crm.data) return <div className="page"><Spinner /></div>;
  if (crm.error) return <div className="page"><ErrorBanner message={crm.error} onRetry={crm.reload} /></div>;
  const p = crm.data?.profiles.get(id ?? '');
  if (!p) return <div className="page"><EmptyState title="Customer not found" action={<Link to="/customers" className="btn btn-secondary">Back to Customers</Link>} /></div>;

  const c = p.contact;
  const phone = (c.phone ?? '').replace(/[^\d+]/g, '');
  const campaignById = new Map((campaigns.data ?? []).map((x) => [x.id, x]));
  const canEmail = !c.unsubscribed_at && effectiveTier(plan) === 'pro';

  return (
    <div className="page">
      <PageHeader
        back={<Link to="/customers" className="back-link">Customers</Link>}
        title={c.name || c.email}
        subtitle={`${CONTACT_SOURCES[c.source] ?? c.source} · customer since ${formatDate(c.created_at)}`}
        actions={<>
          {canEmail && <Button variant="secondary" onClick={() => navigate(`/campaigns/new?to=${c.id}`)}>Email them</Button>}
          <Button variant="ghost" data-role="destructive" onClick={() => setRemoving(true)}>Remove</Button>
        </>}
      />

      <div className="metric-grid cust-tiles">
        <Stat label="Orders" value={String(p.orderCount)} sub={p.lastOrderAt ? `Last ${formatDate(p.lastOrderAt)}` : 'None yet'} />
        <Stat label="Spent" value={formatMoney(p.spent)} sub={p.orderCount ? `${formatMoney(p.spent / p.orderCount)} per order` : '—'} />
        <Stat label="Emails received" value={String(p.emailsSent)} sub={p.lastEmailAt ? `Last ${formatDate(p.lastEmailAt)}` : 'None yet'} />
        <Stat label="Opened" value={p.emailsSent ? `${Math.round((p.emailsOpened / p.emailsSent) * 100)}%` : '—'} sub={`${p.emailsOpened} opened · ${p.emailsClicked} clicked`} />
      </div>

      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Journey">
            <Journey p={p} campaigns={campaignById} />
          </Card>
          <Card title="Orders">
            {p.orders.length === 0 ? <p className="muted small">No orders from this customer yet.</p>
              : <ul className="list">{p.orders.map((o) => <OrderRow key={o.id} o={o} />)}</ul>}
          </Card>
          <Card title="Emails">
            {p.sends.length === 0 ? <p className="muted small">You haven’t emailed this customer yet.</p> : (
              <ul className="list">
                {p.sends.map((s) => {
                  const camp = campaignById.get(s.campaign_id);
                  return (
                    <li key={s.id} className="list-row">
                      <Link to={`/campaigns/${s.campaign_id}`} className="grow">
                        <span className="row-title">{camp?.subject ?? 'Email campaign'}</span>
                        <span className="row-sub">Sent {formatDate(s.sent_at)}</span>
                      </Link>
                      <span className="small">
                        {s.clicked_at ? <b>Clicked</b> : s.opened_at ? 'Opened' : <span className="muted">Not opened</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
        <div className="stack-lg">
          <Card title="Contact">
            <dl className="kv">
              <dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd>
              {phone && <><dt>Phone</dt><dd><a href={`tel:${phone}`}>{c.phone}</a> · <a href={`sms:${phone}`}>Text</a></dd></>}
            </dl>
          </Card>
          <Card title="Tags">
            <TagEditor tags={c.tags ?? []} suggestions={crm.data!.tags}
              onChange={async (next) => { await setContactTags([c.id], () => next, [c]); crm.reload(); }} />
          </Card>
          <Card title="Notes">
            <NotesEditor initial={c.notes ?? ''} onSave={async (n) => { await setContactNotes(c.id, n); toast('Notes saved'); crm.reload(); }} />
          </Card>
          <Card title="Mailing list">
            <Toggle checked={!c.unsubscribed_at} label="On my mailing list" hint="Only people on your mailing list get your email campaigns."
              onChange={async (on) => {
                try { await setSubscribed(c, on); toast(on ? 'Resubscribed' : 'Unsubscribed'); crm.reload(); }
                catch (e: any) { toast(e.message, 'error'); }
              }} />
          </Card>
        </div>
      </div>
      {removing && (
        <ConfirmModal title="Remove this customer?" body={`${c.email} is removed from your customers and mailing list. Their orders stay.`} confirmLabel="Remove" danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => { await deleteContact(c); toast('Customer removed'); navigate('/customers'); }} />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="metric static">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

type JourneyEvent = { at: string; icon: string; title: string; detail?: string; to?: string };

/** Joined, every order, every email (and whether it was opened/clicked), unsubscribed — newest first. */
function Journey({ p, campaigns }: { p: CustomerProfile; campaigns: Map<string, Campaign> }) {
  const events: JourneyEvent[] = [];
  const c = p.contact;
  events.push({ at: c.created_at, icon: '★', title: `Joined from ${(CONTACT_SOURCES[c.source] ?? c.source).toLowerCase()}` });
  for (const o of p.orders) {
    const items = (o.order_items ?? []).filter((i) => !i.deleted_at).map((i) => i.custom_name).filter(Boolean);
    events.push({ at: o.created_at, icon: '◆', title: `Ordered ${formatMoney(effectiveTotal(o))}`, detail: items.slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : ''), to: `/orders/${o.id}` });
  }
  for (const s of p.sends) {
    const subject = campaigns.get(s.campaign_id)?.subject ?? 'an email';
    if (s.sent_at) events.push({ at: s.sent_at, icon: '✉', title: `Emailed “${subject}”`, to: `/campaigns/${s.campaign_id}` });
    if (s.opened_at) events.push({ at: s.opened_at, icon: '◉', title: `Opened “${subject}”`, to: `/campaigns/${s.campaign_id}` });
    if (s.clicked_at) events.push({ at: s.clicked_at, icon: '➜', title: `Clicked in “${subject}”`, to: `/campaigns/${s.campaign_id}` });
  }
  if (c.unsubscribed_at) events.push({ at: c.unsubscribed_at, icon: '⊘', title: 'Unsubscribed from your emails' });
  events.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <ol className="journey">
      {events.map((e, i) => (
        <li key={i}>
          <span className="journey-dot" aria-hidden>{e.icon}</span>
          <span className="grow">
            {e.to ? <Link to={e.to} className="row-title">{e.title}</Link> : <span className="row-title">{e.title}</span>}
            {e.detail && <span className="small muted"> · {e.detail}</span>}
            <div className="small muted">{formatDateTime(e.at)}</div>
          </span>
        </li>
      ))}
    </ol>
  );
}

function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (t: string[]) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function apply(next: string[]) { setBusy(true); try { await onChange(next); } finally { setBusy(false); } }
  const add = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) apply([...tags, v]); setText(''); };
  const unused = suggestions.filter((s) => !tags.includes(s));
  return (
    <div className="stack-sm">
      {tags.length > 0 ? (
        <div className="chips">{tags.map((t) => <span key={t} className="chip">{t}<button aria-label={`Remove ${t}`} disabled={busy} onClick={() => apply(tags.filter((x) => x !== t))}>×</button></span>)}</div>
      ) : <p className="small muted" style={{ margin: 0 }}>Group customers (Wholesale, Weddings, VIP…) to find them and email them together.</p>}
      <form onSubmit={(e) => { e.preventDefault(); add(text); }} className="btn-row">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a tag" maxLength={40} style={{ flex: 1, minWidth: 0 }} />
        <Button variant="secondary" type="submit" disabled={!text.trim() || busy}>Add</Button>
      </form>
      {unused.length > 0 && <div className="chips">{unused.slice(0, 8).map((t) => <button key={t} type="button" className="chip chip-btn" onClick={() => add(t)}>+ {t}</button>)}</div>}
    </div>
  );
}

function NotesEditor({ initial, onSave }: { initial: string; onSave: (n: string) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(initial), [initial]);
  const dirty = text.trim() !== initial.trim();
  return (
    <div className="stack-sm">
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Allergies, favourite flavours, how they found you… Only you see this." />
      {dirty && <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); try { await onSave(text); } finally { setBusy(false); } }}>Save notes</Button>}
    </div>
  );
}
