import { supabase } from './supabase';
import { check } from './api';
import { newId, nowISO } from './format';

// Mirrors iOS PromotionService.swift.

export interface Promotion {
  id: string;
  name: string;
  discount_value: number;
  scope: 'site_wide' | 'listing' | 'category';
  listing_ids: string[];
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  code: string | null;
  code_max_redemptions: number | null;
  code_redemption_count: number;
  banner_text: string;
}

export type PromoStatus = 'active' | 'scheduled' | 'paused' | 'ended';

export function promoStatus(p: Promotion, now = Date.now()): PromoStatus {
  if (!p.is_active) return 'paused';
  if (p.starts_at && Date.parse(p.starts_at) > now) return 'scheduled';
  if (p.ends_at && Date.parse(p.ends_at) <= now) return 'ended';
  return 'active';
}

export function blankPromotion(): Promotion {
  return { id: newId(), name: '', discount_value: 10, scope: 'site_wide', listing_ids: [], starts_at: null, ends_at: null, is_active: true, code: null, code_max_redemptions: null, code_redemption_count: 0, banner_text: '' };
}

export async function listPromotions(userId: string): Promise<Promotion[]> {
  const rows = check(await supabase.from('promotions')
    .select('id, name, discount_type, discount_value, scope, starts_at, ends_at, is_active, code, code_max_redemptions, code_redemption_count, banner_text')
    .eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false })) as any[];
  const scoped = rows.filter((r) => r.scope === 'listing').map((r) => r.id);
  const links = scoped.length
    ? check(await supabase.from('promotion_listings').select('promotion_id, menu_item_id').in('promotion_id', scoped)) as { promotion_id: string; menu_item_id: string }[]
    : [];
  return rows.map((r) => ({
    id: r.id, name: r.name, discount_value: Number(r.discount_value), scope: r.scope,
    listing_ids: links.filter((l) => l.promotion_id === r.id).map((l) => l.menu_item_id),
    starts_at: r.starts_at, ends_at: r.ends_at, is_active: r.is_active, code: r.code,
    code_max_redemptions: r.code_max_redemptions, code_redemption_count: r.code_redemption_count ?? 0, banner_text: r.banner_text ?? '',
  }));
}

export async function savePromotion(userId: string, p: Promotion): Promise<void> {
  const code = p.code?.trim().toUpperCase() || null;
  const banner = p.banner_text.trim();
  check(await supabase.from('promotions').upsert({
    id: p.id, user_id: userId, name: p.name.trim(), discount_type: 'percent', scope: p.scope, discount_value: p.discount_value,
    target_categories: [], starts_at: p.starts_at, ends_at: p.ends_at, code, banner_text: banner || null, is_active: p.is_active,
    code_max_redemptions: code ? p.code_max_redemptions : null, updated_at: nowISO(),
  }, { onConflict: 'id' }));
  check(await supabase.from('promotion_listings').delete().eq('promotion_id', p.id));
  if (p.scope === 'listing' && p.listing_ids.length) {
    check(await supabase.from('promotion_listings').insert(p.listing_ids.map((m) => ({ promotion_id: p.id, menu_item_id: m }))));
  }
}

export async function setPromotionActive(id: string, active: boolean): Promise<void> {
  check(await supabase.from('promotions').update({ is_active: active }).eq('id', id));
}

export async function deletePromotion(id: string): Promise<void> {
  check(await supabase.from('promotions').update({ deleted_at: nowISO() }).eq('id', id));
}
