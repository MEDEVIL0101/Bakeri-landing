import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Textarea, Toggle, useLoad, useToast } from '../../components/ui';
import { getOrder, isStorefrontOrder, saveOrder, type ItemDraft, type OrderDraft } from '../../lib/orders';
import { listMenuItems } from '../../lib/menu';
import { EVENT_COLORS, formatMoney, fromLocalInput, parseNumber, toDateInput, toDateTimeInput } from '../../lib/format';
import type { Order } from '../../lib/types';

function emptyDraft(): OrderDraft {
  const due = new Date();
  due.setDate(due.getDate() + 3);
  due.setHours(12, 0, 0, 0);
  return {
    order_name: '', customer_name: '', customer_phone: '', customer_email: '',
    due_date: due.toISOString(), start_date: null, notes: '', fulfillment_type: 'Pickup',
    delivery_details: '', color_name: 'red', is_paid: false, payment_note: '',
    deposit_amount: 0, deposit_paid: false, deposit_note: '', items: [],
  };
}

function draftFrom(o: Order): OrderDraft {
  return {
    order_name: o.order_name, customer_name: o.customer_name, customer_phone: o.customer_phone,
    customer_email: o.customer_email, due_date: o.due_date, start_date: o.start_date, notes: o.notes,
    fulfillment_type: o.fulfillment_type, delivery_details: o.delivery_details, color_name: o.color_name,
    is_paid: o.is_paid, payment_note: o.payment_note, deposit_amount: o.deposit_amount,
    deposit_paid: !!o.deposit_paid_at, deposit_note: o.deposit_note,
    items: (o.order_items ?? []).map((i) => ({
      id: i.id, custom_name: i.custom_name, quantity: i.quantity, unit: i.unit, price_per_unit: i.price_per_unit,
      notes: i.notes, menu_item_id: i.menu_item_id, recipe_id: i.recipe_id,
    })),
  };
}

export function OrderEditorPage() {
  const { id } = useParams();
  const userId = useUserId();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useLoad(() => (id ? getOrder(id) : Promise.resolve(null)), [id]);
  const menu = useLoad(() => listMenuItems(userId), [userId]);
  const [draft, setDraft] = useState<OrderDraft | null>(id ? null : emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id && existing.data) setDraft(draftFrom(existing.data));
  }, [id, existing.data]);

  if (id && existing.loading) return <div className="page"><Spinner /></div>;
  if (id && existing.data && isStorefrontOrder(existing.data)) return <Navigate to={`/orders/${id}`} replace />;
  if (id && !existing.loading && !existing.data) return <Navigate to="/orders" replace />;
  if (!draft) return <div className="page"><Spinner /></div>;

  const set = <K extends keyof OrderDraft>(k: K, v: OrderDraft[K]) => setDraft({ ...draft, [k]: v });
  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    set('items', draft.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const total = draft.items.reduce((s, i) => s + i.quantity * i.price_per_unit, 0);

  function addFromMenu(menuId: string) {
    const m = menu.data?.find((x) => x.id === menuId);
    if (!m) return;
    set('items', [...draft!.items, {
      custom_name: m.name, quantity: 1, unit: m.unit || 'pieces', price_per_unit: m.default_price,
      notes: '', menu_item_id: m.id, recipe_id: m.recipe_ids?.[0] ?? m.recipe_id ?? null,
    }]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft!.customer_name.trim()) { setError('Add the customer’s name.'); return; }
    setBusy(true); setError(null);
    try {
      const savedId = await saveOrder(userId, draft!, existing.data ?? undefined);
      toast(id ? 'Order saved' : 'Order created');
      navigate(`/orders/${savedId}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="page" onSubmit={submit}>
      <PageHeader
        back={<Link to={id ? `/orders/${id}` : '/orders'} className="back-link">← {id ? 'Order' : 'Orders'}</Link>}
        title={id ? 'Edit order' : 'New order'}
        actions={<Button type="submit" loading={busy}>{id ? 'Save' : 'Create order'}</Button>}
      />
      {error && <ErrorBanner message={error} />}
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Order">
            <Field label="Order name (optional)" hint="e.g. “Emma’s 30th birthday cake”">
              <Input value={draft.order_name} onChange={(e) => set('order_name', e.target.value)} />
            </Field>
            <div className="grid-2">
              <Field label="Due">
                <Input type="datetime-local" required value={toDateTimeInput(draft.due_date)} onChange={(e) => e.target.value && set('due_date', fromLocalInput(e.target.value))} />
              </Field>
              <Field label="Start baking (optional)">
                <Input type="date" value={toDateInput(draft.start_date)} onChange={(e) => set('start_date', e.target.value ? fromLocalInput(e.target.value) : null)} />
              </Field>
            </div>
            <Field label="Calendar colour">
              <div className="swatches">
                {Object.entries(EVENT_COLORS).map(([name, hex]) => (
                  <button type="button" key={name} aria-label={name} className={`swatch ${draft.color_name === name ? 'selected' : ''}`} style={{ background: hex }} onClick={() => set('color_name', name)} />
                ))}
              </div>
            </Field>
          </Card>

          <Card title="Items" actions={<span className="muted">Total {formatMoney(total)}</span>}>
            {draft.items.length > 0 && (
              <div className="item-editor">
                <div className="item-edit-head small muted"><span className="grow">Item</span><span className="w-num">Qty</span><span className="w-num">Each</span><span /></div>
                {draft.items.map((it, i) => (
                  <div key={it.id ?? i} className="item-edit-row">
                    <Input className="grow" placeholder="Item" value={it.custom_name} onChange={(e) => setItem(i, { custom_name: e.target.value })} />
                    <Input className="w-num" type="number" min="0" step="any" aria-label="Quantity" value={it.quantity} onChange={(e) => setItem(i, { quantity: parseNumber(e.target.value) })} />
                    <Input className="w-num" type="number" min="0" step="0.01" aria-label="Price each" value={it.price_per_unit} onChange={(e) => setItem(i, { price_per_unit: parseNumber(e.target.value) })} />
                    <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => set('items', draft.items.filter((_, j) => j !== i))}>×</button>
                    <Input className="item-note" placeholder="Notes (flavour, design…)" value={it.notes} onChange={(e) => setItem(i, { notes: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
            <div className="btn-row">
              {menu.data && menu.data.length > 0 && (
                <Select value="" onChange={(e) => { addFromMenu(e.target.value); e.target.value = ''; }}>
                  <option value="">Add from your menu…</option>
                  {menu.data.map((m) => <option key={m.id} value={m.id}>{m.name} — {formatMoney(m.default_price)}</option>)}
                </Select>
              )}
              <Button type="button" variant="secondary" onClick={() => set('items', [...draft.items, { custom_name: '', quantity: 1, unit: 'pieces', price_per_unit: 0, notes: '', menu_item_id: null, recipe_id: null }])}>
                Add custom item
              </Button>
            </div>
          </Card>

          <Card title="Notes">
            <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Design details, allergies, anything to remember" />
          </Card>
        </div>

        <div className="stack-lg">
          <Card title="Customer">
            <Field label="Name"><Input required value={draft.customer_name} onChange={(e) => set('customer_name', e.target.value)} /></Field>
            <Field label="Phone"><Input type="tel" value={draft.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={draft.customer_email} onChange={(e) => set('customer_email', e.target.value)} /></Field>
            <Field label="Fulfillment">
              <Select value={draft.fulfillment_type} onChange={(e) => set('fulfillment_type', e.target.value)}>
                <option>Pickup</option><option>Delivery</option><option>Shipping</option>
              </Select>
            </Field>
            {draft.fulfillment_type !== 'Pickup' && (
              <Field label={draft.fulfillment_type === 'Shipping' ? 'Shipping address' : 'Delivery details'}>
                <Textarea rows={3} value={draft.delivery_details} onChange={(e) => set('delivery_details', e.target.value)} />
              </Field>
            )}
          </Card>

          <Card title="Payment">
            <Field label="Deposit">
              <Input type="number" min="0" step="0.01" value={draft.deposit_amount || ''} placeholder="0.00" onChange={(e) => set('deposit_amount', parseNumber(e.target.value))} />
            </Field>
            {draft.deposit_amount > 0 && (
              <>
                <Toggle checked={draft.deposit_paid} onChange={(v) => set('deposit_paid', v)} label="Deposit received" />
                <Field label="Deposit note"><Input value={draft.deposit_note} onChange={(e) => set('deposit_note', e.target.value)} placeholder="e-Transfer" /></Field>
              </>
            )}
            <Toggle checked={draft.is_paid} onChange={(v) => set('is_paid', v)} label="Paid in full" />
            <Field label="Payment note"><Input value={draft.payment_note} onChange={(e) => set('payment_note', e.target.value)} placeholder="Cash at pickup" /></Field>
          </Card>
        </div>
      </div>
    </form>
  );
}
