import { supabase } from './supabase';
import { callFunction, check, ApiError } from './api';
import { bumpedTimestamp, newId, nowISO } from './format';
import type { Order, OrderStatus } from './types';

// ── Reads ────────────────────────────────────────────────────────────────

export async function listOrders(userId: string): Promise<Order[]> {
  const rows = check(
    await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('due_date', { ascending: true }),
  ) as Order[];
  return rows.map(cleanItems);
}

export async function getOrder(id: string): Promise<Order | null> {
  const row = check(await supabase.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle()) as Order | null;
  return row && !row.deleted_at ? cleanItems(row) : null;
}

function cleanItems(o: Order): Order {
  return { ...o, order_items: (o.order_items ?? []).filter((i) => !i.deleted_at) };
}

// ── Derived values (mirror Models/Order.swift) ─────────────────────────────

export function itemsTotal(o: Order): number {
  return (o.order_items ?? []).reduce((sum, i) => sum + i.price_per_unit * i.quantity, 0);
}

/** Order.effectiveTotal: the quoted price wins over the item sum. */
export function effectiveTotal(o: Order): number {
  return o.quoted_price && o.quoted_price > 0 ? Number(o.quoted_price) : itemsTotal(o);
}

export function isStorefrontOrder(o: Order): boolean {
  return o.order_source === 'marketplace';
}

export function isOverdue(o: Order): boolean {
  return new Date(o.due_date) < new Date() && !['Delivered', 'Completed', 'Cancelled'].includes(o.status);
}

export const MANUAL_STATUS_FLOW: OrderStatus[] = ['Confirmed', 'Baked', 'Decorated', 'Packaged', 'Delivered'];

const MARKETPLACE_LABELS: Record<string, string> = {
  pending: 'New — needs response',
  pending_quote: 'Quote requested',
  quote_provided: 'Quote sent',
  confirmed: 'Accepted',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  expired: 'Expired',
  awaiting_shipment: 'Paid',
  preparing: 'Preparing to ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

export function statusLabel(o: Order): string {
  if (isStorefrontOrder(o) && o.marketplace_status) return MARKETPLACE_LABELS[o.marketplace_status] ?? o.marketplace_status;
  return o.status;
}

export type Tone = 'neutral' | 'blue' | 'green' | 'red' | 'gold' | 'ink';
export function statusTone(o: Order): Tone {
  const s = isStorefrontOrder(o) ? o.marketplace_status : null;
  if (s === 'pending' || s === 'pending_quote') return 'gold';
  if (s === 'declined' || s === 'cancelled' || s === 'refunded' || s === 'expired' || o.status === 'Cancelled') return 'red';
  if (s === 'completed' || s === 'delivered' || o.status === 'Completed' || o.status === 'Delivered') return 'green';
  if (s === 'quote_provided') return 'neutral';
  return 'blue';
}

/** Needs the vendor to do something right now. */
export function needsAction(o: Order): boolean {
  return isStorefrontOrder(o) && (o.marketplace_status === 'pending' || o.marketplace_status === 'pending_quote');
}

export function isClosed(o: Order): boolean {
  if (isStorefrontOrder(o)) {
    return ['completed', 'declined', 'cancelled', 'refunded', 'expired', 'delivered'].includes(o.marketplace_status ?? '');
  }
  return o.status === 'Completed' || o.status === 'Cancelled' || (o.status === 'Delivered' && o.is_paid);
}

// ── Manual orders (create / edit) ─────────────────────────────────────────

export interface OrderDraft {
  order_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  due_date: string;
  start_date: string | null;
  notes: string;
  fulfillment_type: string;
  delivery_details: string;
  color_name: string;
  is_paid: boolean;
  payment_note: string;
  deposit_amount: number;
  deposit_paid: boolean;
  deposit_note: string;
  items: ItemDraft[];
}

export interface ItemDraft {
  id?: string;
  custom_name: string;
  quantity: number;
  unit: string;
  price_per_unit: number;
  notes: string;
  menu_item_id: string | null;
  recipe_id: string | null;
}

/**
 * Creates or updates a vendor-entered order and its line items. Fields
 * that only edge functions / RPCs may write (payment_status, order_source,
 * marketplace_status, …) are never sent — see SyncService.OrderRow.
 */
export async function saveOrder(userId: string, draft: OrderDraft, existing?: Order): Promise<string> {
  const id = existing?.id ?? newId();
  const ts = bumpedTimestamp(existing?.updated_at);
  const paidAt = draft.is_paid ? (existing?.paid_at ?? nowISO()) : null;
  const depositPaidAt = draft.deposit_amount > 0 && draft.deposit_paid ? (existing?.deposit_paid_at ?? nowISO()) : null;
  const row = {
    id,
    user_id: userId,
    order_name: draft.order_name,
    customer_name: draft.customer_name,
    customer_phone: draft.customer_phone,
    customer_email: draft.customer_email,
    due_date: draft.due_date,
    start_date: draft.start_date,
    notes: draft.notes,
    fulfillment_type: draft.fulfillment_type,
    delivery_details: draft.delivery_details,
    color_name: draft.color_name,
    is_paid: draft.is_paid,
    paid_at: paidAt,
    payment_note: draft.payment_note,
    deposit_amount: draft.deposit_amount,
    deposit_paid_at: depositPaidAt,
    deposit_note: draft.deposit_note,
    updated_at: ts,
    ...(existing
      ? { status: autoStatus(existing.status, draft.is_paid) }
      : { created_at: ts, status: 'Confirmed' }),
  };
  if (existing) {
    check(await supabase.from('orders').update(row).eq('id', id));
  } else {
    check(await supabase.from('orders').insert(row));
  }

  const keepIds = new Set(draft.items.filter((i) => i.id).map((i) => i.id!));
  const removed = (existing?.order_items ?? []).filter((i) => !keepIds.has(i.id));
  if (removed.length) {
    check(
      await supabase
        .from('order_items')
        .update({ deleted_at: ts, updated_at: ts })
        .in('id', removed.map((i) => i.id)),
    );
  }
  const itemRows = draft.items
    .filter((i) => i.custom_name.trim())
    .map((i) => ({
      id: i.id ?? newId(),
      user_id: userId,
      order_id: id,
      custom_name: i.custom_name.trim(),
      quantity: i.quantity,
      unit: i.unit || 'pieces',
      price_per_unit: i.price_per_unit,
      notes: i.notes,
      menu_item_id: i.menu_item_id,
      recipe_id: i.recipe_id,
      updated_at: ts,
      deleted_at: null,
    }));
  if (itemRows.length) check(await supabase.from('order_items').upsert(itemRows, { onConflict: 'id' }));
  return id;
}

function autoStatus(status: OrderStatus, paid: boolean): OrderStatus {
  if (paid && status === 'Delivered') return 'Completed';
  if (!paid && status === 'Completed') return 'Delivered';
  return status;
}

/** Plain field update on an order the vendor owns. */
export async function patchOrder(o: Order, patch: Partial<Order>): Promise<void> {
  const { order_items: _ignored, ...rest } = patch as Order;
  void _ignored;
  check(await supabase.from('orders').update({ ...rest, updated_at: bumpedTimestamp(o.updated_at) }).eq('id', o.id));
}

// Order.autoCompleteIfNeeded / revertCompletionIfNeeded: a manual order
// that is both delivered and paid is Completed; un-paying reverts it.
export async function setManualStatus(o: Order, status: OrderStatus): Promise<void> {
  await patchOrder(o, { status: status === 'Delivered' && o.is_paid ? 'Completed' : status });
}

export async function setPaid(o: Order, paid: boolean): Promise<void> {
  await patchOrder(o, { is_paid: paid, paid_at: paid ? (o.paid_at ?? nowISO()) : null, status: autoStatus(o.status, paid) });
}

export async function deleteOrder(o: Order): Promise<void> {
  const ts = bumpedTimestamp(o.updated_at);
  check(await supabase.from('orders').update({ deleted_at: ts, updated_at: ts }).eq('id', o.id));
  check(await supabase.from('order_items').update({ deleted_at: ts, updated_at: ts }).eq('order_id', o.id).is('deleted_at', null));
}

// ── Storefront order actions (mirror MarketplaceOrderSheet.swift) ──────────

/**
 * Accept a new storefront order. Funds are only held at checkout, so the
 * hold is captured first — if that fails the order must NOT show as
 * accepted (same order of operations as iOS confirmOrder()).
 */
export async function acceptOrder(o: Order, opts: { deliveryWindow?: { start: string; end: string } } = {}): Promise<void> {
  if (o.payment_intent_id) {
    try {
      await callFunction('capture-payment', { order_id: o.id });
    } catch {
      throw new ApiError('Could not charge the customer’s card. Please try again or decline the order.');
    }
  }
  const patch: Record<string, unknown> = { marketplace_status: 'confirmed', status: 'Confirmed' };
  if (o.is_delivery && opts.deliveryWindow) {
    patch.delivery_window_start = opts.deliveryWindow.start;
    patch.delivery_window_end = opts.deliveryWindow.end;
  }
  await patchOrder(o, patch as Partial<Order>);
}

/**
 * Decline a new order or quote request. The DB trigger
 * (trg_fn_marketplace_order_notify) notifies the customer and releases or
 * refunds any payment on its own.
 */
export async function declineOrder(o: Order, message: string): Promise<void> {
  const trimmed = message.trim();
  await patchOrder(o, { marketplace_status: 'declined', status: 'Cancelled', decline_message: trimmed || null });
}

export async function submitQuote(
  o: Order,
  q: { deposit: number; balance: number; note: string; isDelivery: boolean; deliveryAddress: string },
): Promise<void> {
  const total = q.deposit + q.balance;
  if (total <= 0) throw new ApiError('Enter a price for this quote.');
  const depositCents = Math.round(q.deposit * 100);
  const isPartialDeposit = depositCents > 0 && depositCents < total * 100;
  await patchOrder(o, {
    quoted_price: total,
    deposit_amount_cents: depositCents,
    marketplace_status: 'quote_provided',
    quote_expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    quote_note: q.note.trim() || null,
    fulfillment_type: q.isDelivery ? 'Delivery' : 'Pickup',
    is_delivery: q.isDelivery,
    delivery_address: q.isDelivery && q.deliveryAddress.trim() ? q.deliveryAddress.trim() : null,
    payment_flow: isPartialDeposit ? 'deposit_and_save' : 'auth_hold',
  });
}

export async function retractQuote(o: Order): Promise<void> {
  await patchOrder(o, { marketplace_status: 'pending_quote', quoted_price: null, quote_expires_at: null });
}

export async function resendQuoteEmail(o: Order): Promise<void> {
  const res = await callFunction<{ ok?: boolean; error?: string }>('send-guest-quote-email', { order_id: o.id });
  if (!res?.ok) throw new ApiError(res?.error ?? 'Couldn’t send the email. Please try again.');
}

/** Payment collected outside Stripe (e-transfer, cash) for a quote. */
export async function markQuotePaidManually(o: Order): Promise<void> {
  const now = nowISO();
  await patchOrder(o, { is_paid: true, paid_at: now, marketplace_status: 'confirmed' });
}

/** iOS sends DateFormatter .short times, e.g. "2:30 PM". */
export function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** scheduled_pickup_date carries only a day, anchored at noon UTC. */
export function utcNoon(dateInput: string): string {
  const [y, mo, d] = dateInput.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12)).toISOString();
}

export async function markReadyForPickup(o: Order, date: string, start: string, end: string): Promise<{ notified: boolean }> {
  return callFunction('mark-order-ready-for-pickup', {
    order_id: o.id,
    pickup_date: utcNoon(date),
    window_start: shortTime(start),
    window_end: shortTime(end),
  });
}

export async function resendReadyNotification(o: Order): Promise<{ notified: boolean }> {
  return callFunction('mark-order-ready-for-pickup', { order_id: o.id, resend_only: true });
}

export async function markOutForDelivery(o: Order): Promise<void> {
  await patchOrder(o, { marketplace_status: 'out_for_delivery' });
}

export async function setShippingStatus(o: Order, status: 'awaiting_shipment' | 'preparing'): Promise<void> {
  await patchOrder(o, { marketplace_status: status });
}

export async function markShipped(o: Order, carrier: string, tracking: string, notify: boolean): Promise<{ notified: boolean }> {
  return callFunction('mark-order-shipped', {
    order_id: o.id, carrier, tracking_number: tracking.trim() || null, notify,
  });
}

export async function markDelivered(o: Order, notify: boolean): Promise<{ notified: boolean }> {
  return callFunction('mark-order-delivered', { order_id: o.id, notify });
}

/** Records the handoff (authorize_pickup RPC — no money moves here). */
export async function completeOrder(o: Order): Promise<void> {
  check(await supabase.rpc('authorize_pickup', { p_order_id: o.id }));
}

export async function undoCompletion(o: Order): Promise<void> {
  check(await supabase.rpc('undo_order_completion', { p_order_id: o.id }));
}

export async function cancelOrRefund(o: Order): Promise<{ refunded?: boolean; notified?: boolean }> {
  return callFunction('cancel-order', { order_id: o.id });
}

export async function resendDigitalDownload(o: Order): Promise<string> {
  const res = await callFunction<{ orders?: { customer_email?: string; downloads?: unknown[]; emailed?: boolean; error?: string }[] }>(
    'resend-digital-download', { order_id: o.id },
  );
  const r = res.orders?.[0];
  if (!r) throw new ApiError('Something went wrong. Please try again.');
  if (!r.downloads?.length) throw new ApiError(r.error ?? 'No downloadable files could be found for this order.');
  return r.emailed ? `Download email sent to ${r.customer_email ?? 'the customer'}.` : 'Links were re-issued, but the email didn’t send. Please contact the customer directly.';
}

// ── Invoices (mirror InvoiceSectionView.swift) ────────────────────────────

const INVOICE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export async function createInvoice(o: Order, type: 'full' | 'deposit' | 'balance', depositCents?: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 7 }, () => INVOICE_ALPHABET[Math.floor(Math.random() * INVOICE_ALPHABET.length)]).join('');
    // deposit_amount_cents is only written for a deposit invoice — a balance
    // invoice must not overwrite the real deposit figure.
    const patch: Record<string, unknown> = { invoice_code: code, invoice_type: type };
    if (type === 'deposit') patch.deposit_amount_cents = depositCents ?? 0;
    const { error } = await supabase.from('orders').update(patch).eq('id', o.id);
    if (!error) return code;
  }
  throw new ApiError('Couldn’t generate a unique code. Please try again.');
}

export function invoiceURL(code: string): string {
  return `https://bakeriapp.com/pay/?code=${code}`;
}

const INVOICE_EMAIL_ERRORS: Record<string, string> = {
  no_email_on_file: 'This order doesn’t have a customer email on file.',
  generate_invoice_first: 'Create the payment link before emailing it.',
  no_amount_due: 'Add items with a price before sending an invoice.',
  send_failed: 'The email couldn’t be sent. Please try again.',
};

export async function emailInvoice(o: Order): Promise<void> {
  try {
    await callFunction('send-invoice-email', { order_id: o.id });
  } catch (e: any) {
    throw new ApiError(INVOICE_EMAIL_ERRORS[e?.message] ?? 'Couldn’t send the email. Please try again.');
  }
}

/** Order.revenueReceived(in:end:) — deposits count when paid, the balance when the order is paid. */
export function revenueReceived(o: Order, start: Date, end: Date): number {
  if (o.status === 'Cancelled' || o.marketplace_status === 'refunded') return 0;
  let total = 0;
  const dep = Number(o.deposit_amount || 0);
  if (dep > 0 && o.deposit_paid_at) {
    const d = new Date(o.deposit_paid_at);
    if (d >= start && d < end) total += dep;
  }
  if (o.is_paid) {
    const d = new Date(o.paid_at ?? o.updated_at);
    const bal = dep > 0 ? Math.max(0, effectiveTotal(o) - dep) : effectiveTotal(o);
    if (d >= start && d < end) total += bal;
  }
  return total;
}

export function isUnacceptedQuote(o: Order): boolean {
  return isStorefrontOrder(o) && (o.marketplace_status === 'pending_quote' || o.marketplace_status === 'quote_provided');
}
