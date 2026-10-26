import { supabase } from './supabase';
import { check } from './api';
import { newId, nowISO } from './format';

// Mirrors iOS PackagingCost.swift — the vendor's packaging list
// (packaging_items) and packaging attached to orders (order_packaging).
// An attached line copies name/kind/cost from the item, so changing a price
// later doesn't change the profit on orders already attached.

export type PackagingKind = 'box' | 'bag' | 'custom';

export const PACKAGING_KINDS: { kind: PackagingKind; label: string }[] = [
  { kind: 'box', label: 'Box' },
  { kind: 'bag', label: 'Bag' },
  { kind: 'custom', label: 'Custom' },
];

export interface PackagingItem {
  id: string; user_id: string; name: string; kind: PackagingKind; custom_kind: string; price: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}

export interface OrderPackagingLine {
  id: string; user_id: string; order_id: string; packaging_item_id: string | null;
  name: string; kind_label: string; unit_cost: number; quantity: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}

/** "Box", "Bag", or the vendor's own word for a custom kind. */
export function kindLabel(p: Pick<PackagingItem, 'kind' | 'custom_kind'>): string {
  const custom = p.custom_kind.trim();
  if (p.kind === 'custom' && custom) return custom;
  return PACKAGING_KINDS.find((k) => k.kind === p.kind)?.label ?? 'Custom';
}

export async function listPackaging(userId: string): Promise<PackagingItem[]> {
  return check(await supabase.from('packaging_items').select('*').eq('user_id', userId).is('deleted_at', null).order('name')) as PackagingItem[];
}

export async function savePackaging(userId: string, p: { id?: string; name: string; kind: PackagingKind; custom_kind: string; price: number }): Promise<PackagingItem> {
  const ts = nowISO();
  const row = {
    id: p.id ?? newId(), user_id: userId, name: p.name.trim(), kind: p.kind,
    custom_kind: p.kind === 'custom' ? p.custom_kind.trim() : '', price: p.price,
    updated_at: ts, deleted_at: null, ...(p.id ? {} : { created_at: ts }),
  };
  return check(await supabase.from('packaging_items').upsert(row, { onConflict: 'id' }).select().single()) as PackagingItem;
}

export async function deletePackaging(id: string): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('packaging_items').update({ deleted_at: ts, updated_at: ts }).eq('id', id));
}

export async function listOrderPackaging(userId: string, orderId?: string): Promise<OrderPackagingLine[]> {
  let q = supabase.from('order_packaging').select('*').eq('user_id', userId).is('deleted_at', null);
  if (orderId) q = q.eq('order_id', orderId);
  return check(await q.order('created_at')) as OrderPackagingLine[];
}

/** Picking something already on the order bumps its quantity instead of adding a second line. */
export async function attachPackaging(userId: string, orderId: string, item: PackagingItem, existing: OrderPackagingLine[]): Promise<void> {
  const ts = nowISO();
  const same = existing.find((l) => l.packaging_item_id && l.packaging_item_id.toLowerCase() === item.id.toLowerCase());
  if (same) {
    check(await supabase.from('order_packaging').update({ quantity: same.quantity + 1, updated_at: ts }).eq('id', same.id));
    return;
  }
  check(await supabase.from('order_packaging').insert({
    id: newId(), user_id: userId, order_id: orderId, packaging_item_id: item.id,
    name: item.name, kind_label: kindLabel(item), unit_cost: item.price, quantity: 1,
    created_at: ts, updated_at: ts,
  }));
}

/** Quantity 0 removes the line. */
export async function setPackagingQuantity(line: OrderPackagingLine, quantity: number): Promise<void> {
  const ts = nowISO();
  if (quantity <= 0) {
    check(await supabase.from('order_packaging').update({ deleted_at: ts, updated_at: ts }).eq('id', line.id));
  } else {
    check(await supabase.from('order_packaging').update({ quantity, updated_at: ts }).eq('id', line.id));
  }
}

export const lineCost = (l: Pick<OrderPackagingLine, 'unit_cost' | 'quantity'>) => Number(l.unit_cost) * l.quantity;

/** Packaging cost per order id (lowercased), for views that total many orders. */
export function packagingCostByOrder(lines: OrderPackagingLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.order_id.toLowerCase(), (m.get(l.order_id.toLowerCase()) ?? 0) + lineCost(l));
  return m;
}
