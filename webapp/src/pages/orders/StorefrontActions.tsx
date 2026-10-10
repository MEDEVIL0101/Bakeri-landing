import { useState, type ReactNode } from 'react';
import { Button, ConfirmModal, ErrorBanner, Field, Input, Modal, Textarea, Toggle, useToast } from '../../components/ui';
import {
  acceptOrder, cancelOrRefund, completeOrder, declineOrder, effectiveTotal, markDelivered, markOutForDelivery,
  markQuotePaidManually, markReadyForPickup, markShipped, resendDigitalDownload, resendQuoteEmail,
  resendReadyNotification, retractQuote, setShippingStatus, shortTime, submitQuote, undoCompletion,
} from '../../lib/orders';
import { formatDate, formatMoney, parseNumber, toDateInput } from '../../lib/format';
import type { Order } from '../../lib/types';

type Dialog =
  | 'decline' | 'quote' | 'ready' | 'complete' | 'cancel' | 'ship' | 'delivered' | 'undo' | 'accept-delivery' | 'retract' | 'paid-manually'
  | null;

/**
 * The action panel for storefront orders, one branch per marketplace_status
 * — the same transitions MarketplaceOrderSheet.swift offers.
 */
export function StorefrontActions({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = order.marketplace_status;
  const isDigital = order.fulfillment_type === 'Digital';
  const isShipping = ['awaiting_shipment', 'preparing', 'shipped'].includes(s ?? '');

  async function run(key: string, fn: () => Promise<unknown>, okText?: string) {
    setBusy(key); setError(null);
    try {
      await fn();
      if (okText) toast(okText);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const close = () => setDialog(null);
  const done = (msg?: string) => { if (msg) toast(msg); onChanged(); };

  let body: ReactNode = null;
  switch (s) {
    case 'pending':
      body = (
        <>
          <p className="muted">A customer placed this order on your storefront. {order.payment_intent_id ? 'Their card is on hold — it’s charged when you accept.' : ''}</p>
          <div className="btn-row">
            <Button loading={busy === 'accept'} onClick={() => (order.is_delivery ? setDialog('accept-delivery') : run('accept', () => acceptOrder(order), 'Order accepted'))}>
              Accept order
            </Button>
            <Button variant="danger" onClick={() => setDialog('decline')}>Decline</Button>
          </div>
        </>
      );
      break;
    case 'pending_quote':
      body = (
        <>
          <p className="muted">This customer is asking for a quote. Send a price, or decline with a short note.</p>
          <div className="btn-row">
            <Button onClick={() => setDialog('quote')}>Send quote</Button>
            <Button variant="danger" onClick={() => setDialog('decline')}>Decline</Button>
          </div>
        </>
      );
      break;
    case 'quote_provided':
      body = (
        <>
          <p className="muted">
            Quote sent: <strong>{formatMoney(order.quoted_price)}</strong>
            {order.deposit_amount_cents ? ` (deposit ${formatMoney(order.deposit_amount_cents / 100)})` : ''}
            {order.quote_expires_at ? ` · expires ${formatDate(order.quote_expires_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
          {order.quote_note && <p className="quote-note">“{order.quote_note}”</p>}
          <div className="btn-row">
            <Button variant="secondary" loading={busy === 'resend'} onClick={() => run('resend', () => resendQuoteEmail(order), 'Quote email sent')}>Resend quote email</Button>
            <Button variant="secondary" onClick={() => setDialog('paid-manually')}>Mark paid (cash / e-transfer)</Button>
            <Button variant="ghost" onClick={() => setDialog('retract')}>Retract quote</Button>
          </div>
        </>
      );
      break;
    case 'confirmed':
      body = (
        <>
          <p className="muted">Accepted. {order.is_delivery ? 'Mark it out for delivery when it leaves.' : 'Let the customer know when it’s ready to collect.'}</p>
          <div className="btn-row">
            {isDigital ? null : order.is_delivery ? (
              <Button loading={busy === 'ofd'} onClick={() => run('ofd', () => markOutForDelivery(order), 'Marked out for delivery')}>Out for delivery</Button>
            ) : (
              <Button onClick={() => setDialog('ready')}>Ready for pickup</Button>
            )}
            <Button variant="secondary" onClick={() => setDialog('complete')}>Mark completed</Button>
            <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel order</Button>
          </div>
        </>
      );
      break;
    case 'ready_for_pickup':
      body = (
        <>
          <p className="muted">
            Ready for pickup{order.scheduled_pickup_date ? ` on ${formatDate(order.scheduled_pickup_date, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}
            {order.pickup_window_start ? `, ${order.pickup_window_start}–${order.pickup_window_end}` : ''}.
          </p>
          <div className="btn-row">
            <Button onClick={() => setDialog('complete')}>Picked up — complete</Button>
            <Button variant="secondary" onClick={() => setDialog('ready')}>Change pickup time</Button>
            <Button
              variant="secondary"
              loading={busy === 'renotify'}
              onClick={() => run('renotify', async () => {
                const r = await resendReadyNotification(order);
                toast(r.notified ? 'Customer notified again' : 'Saved, but the notification didn’t send — please contact the customer.', r.notified ? 'ok' : 'error');
              })}
            >
              Resend notification
            </Button>
            <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel order</Button>
          </div>
        </>
      );
      break;
    case 'out_for_delivery':
      body = (
        <div className="btn-row">
          <Button onClick={() => setDialog('complete')}>Delivered — complete</Button>
          <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel order</Button>
        </div>
      );
      break;
    case 'awaiting_shipment':
    case 'preparing':
    case 'shipped':
      body = (
        <>
          <div className="steps">
            {(['awaiting_shipment', 'preparing', 'shipped', 'delivered'] as const).map((st, i) => (
              <span key={st} className={`step ${st === s ? 'current' : ''}`}>{i + 1}. {['Paid', 'Preparing', 'Shipped', 'Delivered'][i]}</span>
            ))}
          </div>
          {order.tracking_number && <p className="small muted">{order.shipping_carrier} · Tracking {order.tracking_number}</p>}
          <div className="btn-row">
            {s === 'awaiting_shipment' && (
              <Button variant="secondary" loading={busy === 'prep'} onClick={() => run('prep', () => setShippingStatus(order, 'preparing'))}>Start preparing</Button>
            )}
            {s !== 'shipped' && <Button onClick={() => setDialog('ship')}>Mark shipped</Button>}
            {s === 'shipped' && <Button onClick={() => setDialog('delivered')}>Mark delivered</Button>}
            {s === 'shipped' && <Button variant="secondary" onClick={() => setDialog('ship')}>Correct tracking</Button>}
            <Button variant="ghost" onClick={() => setDialog('cancel')}>Refund order</Button>
          </div>
        </>
      );
      break;
    case 'completed':
      body = (
        <>
          <p className="muted">Completed{order.completed_at ? ` ${formatDate(order.completed_at)}` : ''}.</p>
          <div className="btn-row"><Button variant="ghost" onClick={() => setDialog('undo')}>Undo completion</Button></div>
        </>
      );
      break;
    case 'declined':
    case 'cancelled':
    case 'refunded':
    case 'expired':
      body = (
        <p className="muted">
          This order was {s}.{order.decline_message ? ` Your note: “${order.decline_message}”` : ''}
        </p>
      );
      break;
    default:
      body = null;
  }

  return (
    <div className="actions-panel">
      {body}
      {isDigital && !['pending', 'declined', 'cancelled', 'refunded'].includes(s ?? '') && (
        <div className="btn-row">
          <Button
            variant="secondary"
            loading={busy === 'digital'}
            onClick={() => run('digital', async () => toast(await resendDigitalDownload(order)))}
          >
            Resend download email
          </Button>
        </div>
      )}
      {error && <ErrorBanner message={error} />}

      {dialog === 'decline' && <DeclineDialog order={order} onClose={close} onDone={() => done('Order declined — the customer has been notified')} />}
      {dialog === 'quote' && <QuoteDialog order={order} onClose={close} onDone={() => done('Quote sent')} />}
      {dialog === 'ready' && <ReadyDialog order={order} onClose={close} onDone={done} />}
      {dialog === 'accept-delivery' && <AcceptDeliveryDialog order={order} onClose={close} onDone={() => done('Order accepted')} />}
      {dialog === 'ship' && <ShipDialog order={order} onClose={close} onDone={done} />}
      {dialog === 'complete' && (
        <ConfirmModal title="Complete this order?" body="Marks the order as handed over to the customer." confirmLabel="Mark completed"
          onClose={close} onConfirm={async () => { await completeOrder(order); done('Order completed'); }} />
      )}
      {dialog === 'undo' && (
        <ConfirmModal title="Undo completion?" body="Moves the order back to its previous step." confirmLabel="Undo"
          onClose={close} onConfirm={async () => { await undoCompletion(order); done('Completion undone'); }} />
      )}
      {dialog === 'retract' && (
        <ConfirmModal title="Retract this quote?" body="The customer won’t be able to pay it, and the request goes back to ‘Quote requested’." confirmLabel="Retract quote"
          onClose={close} onConfirm={async () => { await retractQuote(order); done('Quote retracted'); }} />
      )}
      {dialog === 'paid-manually' && (
        <ConfirmModal title="Mark as paid?" body={`Use this when the customer paid ${formatMoney(order.quoted_price)} outside Bakeri (cash, e-transfer). The order moves to Accepted.`} confirmLabel="Mark paid"
          onClose={close} onConfirm={async () => { await markQuotePaidManually(order); done('Marked paid'); }} />
      )}
      {dialog === 'cancel' && (
        <ConfirmModal
          title={isShipping ? 'Refund this order?' : 'Cancel this order?'}
          body={`The customer is refunded ${formatMoney(effectiveTotal(order))} in full and notified. This can’t be undone.`}
          confirmLabel={isShipping ? 'Refund & notify customer' : 'Cancel & refund'}
          danger
          onClose={close}
          onConfirm={async () => {
            const r = await cancelOrRefund(order);
            done(r.notified === false ? 'Refunded — but the email didn’t send, so please contact the customer.' : 'Order cancelled and refunded');
          }}
        />
      )}
      {dialog === 'delivered' && <DeliveredDialog order={order} onClose={close} onDone={done} />}
    </div>
  );
}

function DeclineDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [msg, setMsg] = useState('');
  return (
    <ConfirmModal
      title={order.marketplace_status === 'pending_quote' ? 'Decline this request?' : 'Decline this order?'}
      body={order.payment_intent_id ? 'The customer’s card hold is released and they’re notified.' : 'The customer is notified.'}
      confirmLabel="Decline"
      danger
      onClose={onClose}
      onConfirm={async () => { await declineOrder(order, msg); onDone(); }}
    >
      <Field label="Message to the customer (optional)" hint="Shown prominently on their order page.">
        <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Sorry, I’m fully booked that weekend." />
      </Field>
    </ConfirmModal>
  );
}

function QuoteDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [deposit, setDeposit] = useState('');
  const [balance, setBalance] = useState(order.quoted_price ? String(order.quoted_price) : '');
  const [note, setNote] = useState(order.quote_note ?? '');
  const [delivery, setDelivery] = useState(order.is_delivery);
  const [address, setAddress] = useState(order.delivery_address ?? '');
  const total = parseNumber(deposit) + parseNumber(balance);
  return (
    <ConfirmModal title="Send a quote" confirmLabel={`Send ${formatMoney(total)} quote`} onClose={onClose}
      onConfirm={async () => {
        await submitQuote(order, { deposit: parseNumber(deposit), balance: parseNumber(balance), note, isDelivery: delivery, deliveryAddress: address });
        onDone();
      }}
    >
      <p className="muted small">The customer gets an email with a link to pay. Quotes expire after 72 hours.</p>
      <div className="grid-2">
        <Field label="Deposit (optional)" hint="Paid now to confirm.">
          <Input inputMode="decimal" placeholder="0.00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </Field>
        <Field label={parseNumber(deposit) > 0 ? 'Balance due at pickup' : 'Price'}>
          <Input inputMode="decimal" placeholder="0.00" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </Field>
      </div>
      <Field label="Note to the customer (optional)">
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Toggle checked={delivery} onChange={setDelivery} label="I’ll deliver this order" />
      {delivery && (
        <Field label="Delivery address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      )}
    </ConfirmModal>
  );
}

function ReadyDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (msg?: string) => void }) {
  const [date, setDate] = useState(toDateInput(order.scheduled_pickup_date ?? order.due_date));
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('12:00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reschedule = order.marketplace_status === 'ready_for_pickup';
  return (
    <Modal title={reschedule ? 'Change pickup time' : 'Ready for pickup'} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={async () => {
          if (!date || !start || !end) { setErr('Choose a day and a pickup window.'); return; }
          if (end <= start) { setErr('The window must end after it starts.'); return; }
          setBusy(true); setErr(null);
          try {
            const r = await markReadyForPickup(order, date, start, end);
            onClose();
            onDone(r.notified ? 'Customer notified' : 'Saved, but the notification didn’t send — please contact the customer.');
          } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>{reschedule ? 'Save & notify customer' : 'Notify customer'}</Button>
      </>}
    >
      <p className="muted small">The customer gets an email with the pickup day, time window and address.</p>
      <Field label="Pickup day"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="grid-2">
        <Field label="From"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Until"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}

function AcceptDeliveryDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('14:00');
  return (
    <ConfirmModal title="Accept delivery order" confirmLabel="Accept order" onClose={onClose}
      onConfirm={async () => {
        await acceptOrder(order, { deliveryWindow: { start: shortTime(start), end: shortTime(end) } });
        onDone();
      }}
    >
      <p className="muted small">Delivering to: {order.delivery_address || 'address on the order'}</p>
      <div className="grid-2">
        <Field label="Delivery window from"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Until"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
    </ConfirmModal>
  );
}

function ShipDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (msg?: string) => void }) {
  const [carrier, setCarrier] = useState(order.shipping_carrier ?? '');
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [notify, setNotify] = useState(true);
  return (
    <ConfirmModal title={order.marketplace_status === 'shipped' ? 'Correct tracking' : 'Mark shipped'} confirmLabel="Save" onClose={onClose}
      onConfirm={async () => {
        if (!carrier.trim()) throw new Error('Enter the carrier.');
        const r = await markShipped(order, carrier.trim(), tracking, notify);
        onDone(notify && !r.notified ? 'Saved, but the email didn’t send — please contact the customer.' : 'Marked shipped');
      }}
    >
      <Field label="Carrier"><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Canada Post, UPS…" list="carriers" /></Field>
      <datalist id="carriers">{['Canada Post', 'UPS', 'FedEx', 'Purolator', 'USPS', 'DHL'].map((c) => <option key={c} value={c} />)}</datalist>
      <Field label="Tracking number (optional)"><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
      <Toggle checked={notify} onChange={setNotify} label="Email the customer" />
    </ConfirmModal>
  );
}

function DeliveredDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (msg?: string) => void }) {
  const [notify, setNotify] = useState(true);
  return (
    <ConfirmModal title="Mark delivered?" confirmLabel="Mark delivered" onClose={onClose}
      onConfirm={async () => {
        const r = await markDelivered(order, notify);
        onDone(notify && !r.notified ? 'Saved, but the email didn’t send.' : 'Marked delivered');
      }}
    >
      <Toggle checked={notify} onChange={setNotify} label="Email the customer" />
    </ConfirmModal>
  );
}
