import { OrderMessages } from './OrderMessages';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, PageHeader, Select, Spinner, useLoad, useToast } from '../../components/ui';
import {
  MANUAL_STATUS_FLOW, createInvoice, deleteOrder, effectiveTotal, emailInvoice, getOrder, invoiceURL, isStorefrontOrder,
  itemsTotal, setManualStatus, setPaid, statusLabel, statusTone,
} from '../../lib/orders';
import { STORAGE_PUBLIC_URL } from '../../lib/supabase';
import { formatDate, formatDateTime, formatMoney, parseNumber } from '../../lib/format';
import type { Order } from '../../lib/types';
import { StorefrontActions } from './StorefrontActions';
import { FormAnswers } from './FormAnswers';

export function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: order, loading, error, reload } = useLoad(() => getOrder(id!), [id]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (loading && !order) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!order) return <div className="page"><EmptyState title="Order not found" action={<Link to="/orders">Back to orders</Link>} /></div>;

  const storefront = isStorefrontOrder(order);
  const title = order.order_name || order.customer_name || order.buyer_display_name || 'Order';

  return (
    <div className="page">
      <PageHeader
        back={<Link to="/orders" className="back-link">← Orders</Link>}
        title={title}
        subtitle={<><Badge tone={statusTone(order)}>{statusLabel(order)}</Badge>{' '}<span className="muted">Due {formatDate(order.due_date, { weekday: 'long', month: 'long', day: 'numeric' })}</span></>}
        actions={!storefront && (
          <>
            <Link to={`/orders/${order.id}/edit`} className="btn btn-secondary">Edit</Link>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        )}
      />

      <div className="detail-grid">
        <div className="stack-lg">
          {storefront && (
            <Card title="Next step">
              <StorefrontActions order={order} onChanged={reload} />
            </Card>
          )}
          {!storefront && <ManualControls order={order} onChanged={reload} />}

          <Card title="Items">
            <ItemsTable order={order} />
          </Card>

          {order.form_responses && (
            <Card title="Order form answers">
              <FormAnswers raw={order.form_responses} />
            </Card>
          )}
          {(order.order_items ?? []).some((i) => i.form_responses) && (
            <Card title="Item details">
              {(order.order_items ?? []).filter((i) => i.form_responses).map((i) => (
                <div key={i.id} className="stack">
                  <h3 className="h3">{i.custom_name}</h3>
                  <FormAnswers raw={i.form_responses} />
                </div>
              ))}
            </Card>
          )}
          <InspirationPhotos order={order} />

          {order.notes && (
            <Card title="Notes"><p className="prewrap">{order.notes}</p></Card>
          )}
          {order.buyer_profile_id && <OrderMessages order={order} userId={order.user_id} />}
        </div>

        <div className="stack-lg">
          <Card title="Customer">
            <dl className="kv">
              <dt>Name</dt><dd>{order.customer_name || order.buyer_display_name || '—'}</dd>
              {order.customer_email && <><dt>Email</dt><dd><a href={`mailto:${order.customer_email}`}>{order.customer_email}</a></dd></>}
              {order.customer_phone && <><dt>Phone</dt><dd><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></dd></>}
              <dt>Fulfillment</dt><dd>{order.fulfillment_type}</dd>
              {order.delivery_address && <><dt>Deliver to</dt><dd>{order.delivery_address}</dd></>}
              {order.delivery_window_start && <><dt>Delivery window</dt><dd>{order.delivery_window_start}–{order.delivery_window_end}</dd></>}
              {order.shipping_address && <><dt>Ship to</dt><dd className="prewrap">{formatAddress(order.shipping_address)}</dd></>}
              {order.delivery_details && <><dt>Details</dt><dd className="prewrap">{order.delivery_details}</dd></>}
              <dt>Placed</dt><dd>{formatDateTime(order.created_at)}</dd>
            </dl>
          </Card>
          <PaymentCard order={order} />
          {!storefront && <InvoiceCard order={order} onChanged={reload} />}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete this order?"
          body="It’s removed from Bakeri on all your devices."
          confirmLabel="Delete order"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await deleteOrder(order); toast('Order deleted'); navigate('/orders'); }}
        />
      )}
    </div>
  );
}

function formatAddress(a: any): string {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return [a.name, a.line1, a.line2, [a.city, a.state ?? a.province, a.postal_code].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n');
}

function ItemsTable({ order }: { order: Order }) {
  const items = order.order_items ?? [];
  if (!items.length) return <p className="muted">No line items.</p>;
  return (
    <>
      <div className="table-scroll"><table className="table">
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
        <tbody>
          {items.map((i) => {
            const breakdown = Array.isArray(i.variant_breakdown) ? i.variant_breakdown : safeParse(i.variant_breakdown);
            return (
              <tr key={i.id}>
                <td>
                  <div>{i.custom_name}</div>
                  {(i.variant_label || i.tier_label) && <div className="small muted">{[i.tier_label, i.variant_label].filter(Boolean).join(' · ')}</div>}
                  {breakdown?.length > 0 && <div className="small muted">{breakdown.map((b: any) => `${b.quantity}× ${b.name}`).join(', ')}</div>}
                  {i.preorder_date && <div className="small muted">For {formatDate(i.preorder_date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>}
                  {i.notes && <div className="small muted prewrap">{i.notes}</div>}
                </td>
                <td className="num">{i.quantity} {i.unit !== 'pieces' ? i.unit : ''}</td>
                <td className="num">{formatMoney(i.price_per_unit)}</td>
                <td className="num">{formatMoney(i.price_per_unit * i.quantity)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}

function safeParse(v: unknown): any[] {
  if (typeof v !== 'string') return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

function PaymentCard({ order }: { order: Order }) {
  const total = effectiveTotal(order);
  const storefront = isStorefrontOrder(order);
  const deposit = storefront ? (order.deposit_amount_cents ?? 0) / 100 : order.deposit_amount;
  const ps = order.payment_status;
  const paidText = storefront
    ? ps === 'captured' ? 'Paid' : ps === 'deposit_paid' ? 'Deposit paid' : ps === 'authorized' ? 'Card on hold' : ps === 'refunded' ? 'Refunded' : order.is_paid ? 'Paid' : 'Unpaid'
    : order.is_paid ? 'Paid' : deposit > 0 && order.deposit_paid_at ? 'Deposit paid' : 'Unpaid';
  return (
    <Card title="Payment">
      <dl className="kv">
        {order.quoted_price ? <><dt>Items</dt><dd>{formatMoney(itemsTotal(order))}</dd><dt>Quoted</dt><dd>{formatMoney(order.quoted_price)}</dd></> : null}
        <dt>Total</dt><dd><strong>{formatMoney(total)}</strong></dd>
        {order.tax_amount_cents > 0 && <><dt>Tax</dt><dd>{formatMoney(order.tax_amount_cents / 100)}</dd></>}
        {deposit > 0 && <><dt>Deposit</dt><dd>{formatMoney(deposit)}{order.deposit_paid_at ? ` · paid ${formatDate(order.deposit_paid_at)}` : ''}</dd></>}
        {deposit > 0 && <><dt>Balance</dt><dd>{formatMoney(Math.max(0, total - deposit))}</dd></>}
        <dt>Status</dt><dd>{paidText}{order.paid_at ? ` · ${formatDate(order.paid_at)}` : ''}</dd>
        {order.payment_note && <><dt>Note</dt><dd>{order.payment_note}</dd></>}
        {order.baker_payout_cents != null && <><dt>Your payout</dt><dd>{formatMoney(order.baker_payout_cents / 100)}</dd></>}
      </dl>
    </Card>
  );
}

function ManualControls({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cancelled = order.status === 'Cancelled';
  const idx = MANUAL_STATUS_FLOW.indexOf(order.status === 'Completed' ? 'Delivered' : order.status);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true); setErr(null);
    try { await fn(); toast(ok); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Card title="Progress">
      {cancelled ? (
        <div className="btn-row">
          <p className="muted grow">This order is cancelled.</p>
          <Button variant="secondary" loading={busy} onClick={() => run(() => setManualStatus(order, 'Confirmed'), 'Order restored')}>Restore order</Button>
        </div>
      ) : (
        <>
          <div className="steps clickable">
            {MANUAL_STATUS_FLOW.map((st, i) => (
              <button key={st} disabled={busy} className={`step ${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}`} onClick={() => run(() => setManualStatus(order, st), `Marked ${st.toLowerCase()}`)}>
                {st}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <Button variant={order.is_paid ? 'secondary' : 'primary'} loading={busy} onClick={() => run(() => setPaid(order, !order.is_paid), order.is_paid ? 'Marked unpaid' : 'Marked paid')}>
              {order.is_paid ? 'Mark unpaid' : 'Mark paid'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => run(() => setManualStatus(order, 'Cancelled'), 'Order cancelled')}>Cancel order</Button>
          </div>
          {order.status === 'Completed' && <p className="small muted">Completed — delivered and paid.</p>}
        </>
      )}
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}

function InvoiceCard({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<'full' | 'deposit' | 'balance'>('full');
  const [depositStr, setDepositStr] = useState(order.deposit_amount ? String(order.deposit_amount) : '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (order.is_paid) return null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  if (order.invoice_code) {
    const url = invoiceURL(order.invoice_code);
    return (
      <Card title="Payment link">
        <p className="small muted">Send this link so the customer can pay by card ({order.invoice_type} payment).</p>
        <div className="copy-row">
          <code className="ellipsis">{url}</code>
          <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(url); toast('Link copied'); }}>Copy</Button>
        </div>
        <div className="btn-row">
          {order.customer_email && (
            <Button variant="secondary" loading={busy === 'email'} onClick={() => run('email', async () => { await emailInvoice(order); toast(`Emailed to ${order.customer_email}`); })}>
              Email to customer
            </Button>
          )}
        </div>
        {err && <ErrorBanner message={err} />}
      </Card>
    );
  }

  const total = effectiveTotal(order);
  return (
    <Card title="Request payment">
      <p className="small muted">Create a link your customer can use to pay by card.</p>
      <Field label="Amount">
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="full">Full amount ({formatMoney(total)})</option>
          <option value="deposit">Deposit</option>
          <option value="balance">Remaining balance</option>
        </Select>
      </Field>
      {type === 'deposit' && (
        <Field label="Deposit amount"><input className="input" inputMode="decimal" value={depositStr} onChange={(e) => setDepositStr(e.target.value)} /></Field>
      )}
      <Button
        loading={busy === 'create'}
        disabled={total <= 0}
        onClick={() => run('create', async () => {
          const cents = Math.round(parseNumber(depositStr) * 100);
          if (type === 'deposit' && cents <= 0) throw new Error('Enter the deposit amount.');
          await createInvoice(order, type, cents);
          toast('Payment link created');
          onChanged();
        })}
      >
        Create payment link
      </Button>
      {total <= 0 && <p className="small muted">Add item prices to this order first.</p>}
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}

// In-app checkout uploads up to 3 photos as photo_0..2 under the lowercase
// order id; there's no count column, so probe each and hide the misses
// (same as MarketplaceOrderSheet.loadInspirationPhotos).
function InspirationPhotos({ order }: { order: Order }) {
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  if (!isStorefrontOrder(order)) return null;
  const urls = [0, 1, 2].map((n) => `${STORAGE_PUBLIC_URL}/inspiration-photos/${order.id.toLowerCase()}/photo_${n}.jpg`);
  const any = Object.values(loaded).some(Boolean);
  return (
    <div className="card" hidden={!any}>
      <header className="card-header"><h2 className="card-title">Inspiration photos</h2></header>
      <div className="photo-grid">
        {urls.map((u, n) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" hidden={!loaded[n]}>
            <img src={u} alt="" onLoad={() => setLoaded((l) => ({ ...l, [n]: true }))} onError={() => setLoaded((l) => ({ ...l, [n]: false }))} />
          </a>
        ))}
      </div>
    </div>
  );
}
