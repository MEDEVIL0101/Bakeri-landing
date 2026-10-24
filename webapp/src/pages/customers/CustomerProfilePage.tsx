import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, PageHeader, Spinner, Toggle, useLoad, useToast } from '../../components/ui';
import { CONTACT_SOURCES, deleteContact, getContact, setSubscribed } from '../../lib/data';
import { formatDate } from '../../lib/format';
import { listOrders } from '../../lib/orders';
import type { Contact, Order } from '../../lib/types';
import { OrderRow } from '../Dashboard';

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10);

/** Orders that belong to this customer: same email, or same phone (orders typed in without an email). */
function ordersFor(c: Contact, orders: Order[]): Order[] {
  const email = c.email.trim().toLowerCase();
  const phone = digits(c.phone);
  return orders
    .filter((o) => (o.customer_email ?? '').trim().toLowerCase() === email || (phone.length >= 7 && digits(o.customer_phone) === phone))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A customer's profile (mirrors the app's CustomerProfileView): contact, mailing list, their orders. */
export function CustomerProfilePage() {
  const { id } = useParams();
  const userId = useUserId();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [contact, orders] = await Promise.all([getContact(id!), listOrders(userId)]);
    return { contact, orders };
  }, [id, userId]);
  const [removing, setRemoving] = useState(false);

  if (loading && !data) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBanner message={error} onRetry={reload} /></div>;
  const c = data?.contact;
  if (!c) return <div className="page"><EmptyState title="Customer not found" action={<Link to="/customers" className="btn btn-secondary">Back to Customers</Link>} /></div>;

  const orders = ordersFor(c, data!.orders);
  const phone = (c.phone ?? '').replace(/[^\d+]/g, '');

  return (
    <div className="page">
      <PageHeader
        back={<Link to="/customers" className="back-link">Customers</Link>}
        title={c.name || c.email}
        subtitle={`${CONTACT_SOURCES[c.source] ?? c.source} · customer since ${formatDate(c.created_at)}${orders.length ? ` · ${orders.length} order${orders.length === 1 ? '' : 's'}` : ''}`}
        actions={<Button variant="ghost" data-role="destructive" onClick={() => setRemoving(true)}>Remove</Button>}
      />
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Orders">
            {orders.length === 0 ? (
              <p className="muted small">No orders from this customer yet.</p>
            ) : (
              <ul className="list">{orders.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
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
          <Card title="Mailing list">
            <Toggle checked={!c.unsubscribed_at} label="On my mailing list" hint="Only people on your mailing list get your email campaigns."
              onChange={async (on) => {
                try { await setSubscribed(c, on); toast(on ? 'Resubscribed' : 'Unsubscribed'); reload(); }
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
