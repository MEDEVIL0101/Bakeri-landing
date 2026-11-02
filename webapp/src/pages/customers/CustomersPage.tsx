import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Badge, Button, ConfirmModal, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from '../../components/ui';
import { CONTACT_SOURCES, addContact, deleteContact, setContactTags, setSubscribed } from '../../lib/data';
import { csvEscape, downloadText, formatDate, formatMoney } from '../../lib/format';
import type { CustomerProfile } from '../../lib/crm';
import type { Contact } from '../../lib/types';
import { useCrm } from './useCrm';

type Show = 'all' | 'subscribed' | 'unsubscribed' | 'ordered' | 'never_ordered' | 'lapsed';
const SHOW_LABELS: Record<Show, string> = {
  all: 'All', subscribed: 'Subscribed', unsubscribed: 'Unsubscribed',
  ordered: 'Have ordered', never_ordered: 'Never ordered', lapsed: 'No order in 90 days',
};

export function CustomersPage() {
  const userId = useUserId();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useCrm(userId);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [tagging, setTagging] = useState<'add' | 'remove' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const now = Date.now();
    return [...(data?.profiles.values() ?? [])]
      .filter(({ contact: c, orderCount, lastOrderAt }) => {
        switch (show) {
          case 'subscribed': return !c.unsubscribed_at;
          case 'unsubscribed': return !!c.unsubscribed_at;
          case 'ordered': return orderCount > 0;
          case 'never_ordered': return orderCount === 0;
          case 'lapsed': return !!lastOrderAt && now - new Date(lastOrderAt).getTime() > 90 * 86400000;
          default: return true;
        }
      })
      .filter((p) => !tag || (p.contact.tags ?? []).includes(tag))
      .filter((p) => !term || [p.contact.email, p.contact.name, p.contact.phone, ...(p.contact.tags ?? [])].some((v) => v?.toLowerCase().includes(term)))
      .sort((a, b) => b.contact.created_at.localeCompare(a.contact.created_at));
  }, [data, q, show, tag]);

  const subscribed = (data?.contacts ?? []).filter((c) => !c.unsubscribed_at).length;
  const visibleIds = rows.map((r) => r.contact.id);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const pickedSubscribed = rows.filter((r) => selected.has(r.contact.id) && !r.contact.unsubscribed_at).map((r) => r.contact.id);

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      for (const id of visibleIds) allOn ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function exportCSV() {
    const header = ['Email', 'Name', 'Phone', 'Source', 'Subscribed', 'Tags', 'Orders', 'Spent', 'Last order', 'Emails received', 'Emails opened', 'Added'];
    const lines = rows.map((p) => {
      const c = p.contact;
      return [c.email, c.name, c.phone, CONTACT_SOURCES[c.source] ?? c.source, c.unsubscribed_at ? 'No' : 'Yes', (c.tags ?? []).join('; '),
        String(p.orderCount), p.spent.toFixed(2), formatDate(p.lastOrderAt), String(p.emailsSent), String(p.emailsOpened), formatDate(c.created_at)]
        .map(csvEscape).join(',');
    });
    downloadText(`bakeri-customers-${new Date().toISOString().slice(0, 10)}.csv`, [header.join(','), ...lines].join('\n'));
  }

  async function toggleSub(c: Contact) {
    try { await setSubscribed(c, !!c.unsubscribed_at); toast(c.unsubscribed_at ? 'Resubscribed' : 'Unsubscribed'); reload(); }
    catch (e: any) { toast(e.message, 'error'); }
  }

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        subtitle={data ? `${data.contacts.length} contacts · ${subscribed} on your mailing list` : 'Everyone who ordered or signed up on your storefront.'}
        actions={<>
          <Button variant="secondary" onClick={exportCSV} disabled={!rows.length}>Export CSV</Button>
          <Button data-icon="plus" onClick={() => setAdding(true)}>Add contact</Button>
        </>}
      />
      <div className="toolbar">
        <Select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show">
          {(Object.keys(SHOW_LABELS) as Show[]).map((k) => <option key={k} value={k}>{SHOW_LABELS[k]}</option>)}
        </Select>
        {(data?.tags.length ?? 0) > 0 && (
          <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
            <option value="">Any tag</option>
            {data!.tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        )}
        <Input type="search" className="search" placeholder="Search customers or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span><b>{selected.size}</b> selected</span>
          <span className="btn-row">
            <Button onClick={() => navigate(`/campaigns/new?to=${pickedSubscribed.join(',')}`)} disabled={!pickedSubscribed.length}
              title={pickedSubscribed.length ? undefined : 'None of them are on your mailing list'}>
              Email {pickedSubscribed.length === selected.size ? 'them' : `${pickedSubscribed.length} subscribed`}
            </Button>
            <Button variant="secondary" onClick={() => setTagging('add')}>Add tag</Button>
            {(data?.tags.length ?? 0) > 0 && <Button variant="secondary" onClick={() => setTagging('remove')}>Remove tag</Button>}
            <button className="link-btn small" onClick={() => setSelected(new Set())}>Clear</button>
          </span>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="card">
        {loading && !data ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={q || tag || show !== 'all' ? 'No customers match' : 'No customers yet'} body={!q && !tag && show === 'all' ? 'People who order from you or join your mailing list show up here.' : undefined} />
        ) : (
          <div className="table-scroll"><table className="table table-rows">
            <thead><tr>
              <th className="col-check"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th>
              <th>Customer</th>
              <th className="hide-sm">Orders</th>
              <th className="hide-sm">Emails</th>
              <th>Mailing list</th>
              <th />
            </tr></thead>
            <tbody>
              {rows.map((p) => <CustomerRow key={p.contact.id} p={p} checked={selected.has(p.contact.id)}
                onCheck={() => toggleOne(p.contact.id)} onOpen={() => navigate(`/customers/${p.contact.id}`)}
                onToggleSub={() => toggleSub(p.contact)} onRemove={() => setRemoving(p.contact)} />)}
            </tbody>
          </table></div>
        )}
      </div>

      {adding && <AddContactModal userId={userId} onClose={() => setAdding(false)} onAdded={() => { toast('Contact added'); reload(); }} />}
      {tagging && data && (
        <TagModal mode={tagging} existing={data.tags} count={selected.size} onClose={() => setTagging(null)}
          onApply={async (t) => {
            await setContactTags([...selected], (tags) => tagging === 'add' ? [...tags, t] : tags.filter((x) => x !== t), data.contacts);
            toast(tagging === 'add' ? `Tagged ${selected.size} “${t}”` : `Removed “${t}”`);
            reload();
          }} />
      )}
      {removing && (
        <ConfirmModal title="Remove this contact?" body={`${removing.email} is removed from your customers and mailing list.`} confirmLabel="Remove" danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => { await deleteContact(removing); toast('Contact removed'); reload(); }} />
      )}
    </div>
  );
}

function CustomerRow({ p, checked, onCheck, onOpen, onToggleSub, onRemove }: {
  p: CustomerProfile; checked: boolean; onCheck: () => void; onOpen: () => void; onToggleSub: () => void; onRemove: () => void;
}) {
  const c = p.contact;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    // The whole row opens the customer's profile; the controls in it stop the click.
    <tr className={`row-link ${checked ? 'row-selected' : ''}`} onClick={onOpen}>
      <td className="col-check" onClick={stop}><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${c.name || c.email}`} /></td>
      <td>
        <Link className="row-title" to={`/customers/${c.id}`} onClick={stop}>{c.name || c.email}</Link>
        {c.name && <div className="small muted">{c.email}</div>}
        {(c.tags ?? []).length > 0 && <div className="chips tag-chips">{c.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
      </td>
      <td className="hide-sm">
        {p.orderCount ? <>{p.orderCount} · {formatMoney(p.spent)}<div className="small muted">Last {formatDate(p.lastOrderAt)}</div></> : <span className="muted">None yet</span>}
      </td>
      <td className="hide-sm">
        {p.emailsSent ? <>{p.emailsSent} sent<div className="small muted">{p.emailsOpened} opened{p.emailsClicked ? ` · ${p.emailsClicked} clicked` : ''}</div></> : <span className="muted">None yet</span>}
      </td>
      <td>
        <button className="link-btn" onClick={(e) => { stop(e); onToggleSub(); }} title={c.unsubscribed_at ? 'Resubscribe' : 'Unsubscribe'}>
          {c.unsubscribed_at ? <Badge>Unsubscribed</Badge> : <Badge tone="blue">Subscribed</Badge>}
        </button>
      </td>
      <td className="num"><button className="icon-btn sm" aria-label="Remove contact" onClick={(e) => { stop(e); onRemove(); }}>×</button></td>
    </tr>
  );
}

function TagModal({ mode, existing, count, onClose, onApply }: {
  mode: 'add' | 'remove'; existing: string[]; count: number; onClose: () => void; onApply: (tag: string) => Promise<void>;
}) {
  const [tag, setTag] = useState(mode === 'remove' ? existing[0] ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={mode === 'add' ? `Tag ${count} customer${count === 1 ? '' : 's'}` : `Remove a tag from ${count}`} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!tag.trim()} onClick={async () => {
          setBusy(true); setErr(null);
          try { await onApply(tag.trim()); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>{mode === 'add' ? 'Add tag' : 'Remove tag'}</Button>
      </>}
    >
      {mode === 'add' ? (
        <>
          <Field label="Tag" hint="Groups like “Wholesale”, “Weddings” or “VIP”. Use them to find people and to send campaigns.">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="VIP" autoFocus maxLength={40} />
          </Field>
          {existing.length > 0 && (
            <div className="chips">{existing.map((t) => <button key={t} type="button" className={`chip chip-btn ${tag === t ? 'on' : ''}`} onClick={() => setTag(t)}>{t}</button>)}</div>
          )}
        </>
      ) : (
        <Field label="Tag">
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>{existing.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        </Field>
      )}
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}

function AddContactModal({ userId, onClose, onAdded }: { userId: string; onClose: () => void; onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Add a contact" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!consent || !email.trim()} onClick={async () => {
          setBusy(true); setErr(null);
          try { await addContact(userId, { email, name, phone }); onAdded(); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Add contact</Button>
      </>}
    >
      <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Phone (optional)"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        This person agreed to receive emails from my business.
      </label>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}
