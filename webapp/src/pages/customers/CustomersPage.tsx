import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Badge, Button, ConfirmModal, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import { CONTACT_SOURCES, addContact, deleteContact, listContacts, setSubscribed } from '../../lib/data';
import { csvEscape, downloadText, formatDate } from '../../lib/format';
import type { Contact } from '../../lib/types';

export function CustomersPage() {
  const userId = useUserId();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => listContacts(userId), [userId]);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'subscribed' | 'unsubscribed'>('all');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Contact | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => show === 'all' || (show === 'subscribed' ? !c.unsubscribed_at : !!c.unsubscribed_at))
      .filter((c) => !term || [c.email, c.name, c.phone].some((v) => v?.toLowerCase().includes(term)));
  }, [data, q, show]);

  const subscribed = (data ?? []).filter((c) => !c.unsubscribed_at).length;

  function exportCSV() {
    const header = ['Email', 'Name', 'Phone', 'Source', 'Subscribed', 'Added'];
    const lines = rows.map((c) => [c.email, c.name, c.phone, CONTACT_SOURCES[c.source] ?? c.source, c.unsubscribed_at ? 'No' : 'Yes', formatDate(c.created_at)].map(csvEscape).join(','));
    downloadText(`bakeri-customers-${new Date().toISOString().slice(0, 10)}.csv`, [header.join(','), ...lines].join('\n'));
  }

  async function toggle(c: Contact) {
    try { await setSubscribed(c, !!c.unsubscribed_at); toast(c.unsubscribed_at ? 'Resubscribed' : 'Unsubscribed'); reload(); }
    catch (e: any) { toast(e.message, 'error'); }
  }

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        subtitle={data ? `${data.length} contacts · ${subscribed} on your mailing list` : 'Everyone who ordered or signed up on your storefront.'}
        actions={<>
          <Button variant="secondary" onClick={exportCSV} disabled={!rows.length}>Export CSV</Button>
          <Button onClick={() => setAdding(true)}>Add contact</Button>
        </>}
      />
      <div className="toolbar">
        <div className="pills">
          {(['all', 'subscribed', 'unsubscribed'] as const).map((k) => (
            <button key={k} className={`pill ${show === k ? 'active' : ''}`} onClick={() => setShow(k)}>{k === 'all' ? 'All' : k === 'subscribed' ? 'Subscribed' : 'Unsubscribed'}</button>
          ))}
        </div>
        <Input type="search" className="search" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="card">
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={q ? 'No customers match' : 'No customers yet'} body={!q ? 'People who order from you or join your mailing list show up here.' : undefined} />
        ) : (
          <div className="table-scroll"><table className="table table-rows">
            <thead><tr><th>Customer</th><th className="hide-sm">Source</th><th className="hide-sm">Added</th><th>Mailing list</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="row-title">{c.name || c.email}</div>
                    {c.name && <div className="small muted">{c.email}</div>}
                    {c.phone && <div className="small muted">{c.phone}</div>}
                    {c.first_order_id && <Link className="small" to={`/orders/${c.first_order_id}`}>First order</Link>}
                  </td>
                  <td className="hide-sm">{CONTACT_SOURCES[c.source] ?? c.source}</td>
                  <td className="hide-sm">{formatDate(c.created_at)}</td>
                  <td>
                    <button className="link-btn" onClick={() => toggle(c)} title={c.unsubscribed_at ? 'Resubscribe' : 'Unsubscribe'}>
                      {c.unsubscribed_at ? <Badge>Unsubscribed</Badge> : <Badge tone="blue">Subscribed</Badge>}
                    </button>
                  </td>
                  <td className="num"><button className="icon-btn sm" aria-label="Remove contact" onClick={() => setRemoving(c)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {adding && <AddContactModal userId={userId} onClose={() => setAdding(false)} onAdded={() => { toast('Contact added'); reload(); }} />}
      {removing && (
        <ConfirmModal title="Remove this contact?" body={`${removing.email} is removed from your customers and mailing list.`} confirmLabel="Remove" danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => { await deleteContact(removing); toast('Contact removed'); reload(); }} />
      )}
    </div>
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
