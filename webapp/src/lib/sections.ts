// Listing sections ("Halloween", "Gift boxes", …) — the free-text
// menu_items.category, shown as headed groups on the storefront. Their order
// lives in profiles.storefront_design.section_order (names, matched
// case-insensitively) so both storefront pages can read it from the profile
// they already get. Sections not in the list follow alphabetically; listings
// with no section come last.

import { supabase } from './supabase';
import { check } from './api';
import { nowISO } from './format';

/** bakeriapp.com/<slug>?item=<first 8 hex of the id> — opens the storefront on this product (baker/*.html). */
export function listingShareURL(slug: string, listingId: string): string {
  return `https://bakeriapp.com/${encodeURIComponent(slug)}?item=${listingId.toLowerCase().replace(/-/g, '').slice(0, 8)}`;
}

export function sectionKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Distinct section names in display order. */
export function orderedSections(names: string[], order: string[] | null | undefined): string[] {
  const seen = new Map<string, string>();
  names.forEach((n) => { const t = n.trim(); if (t && !seen.has(sectionKey(t))) seen.set(sectionKey(t), t); });
  const rank = new Map((order ?? []).map((n, i) => [sectionKey(n), i]));
  return [...seen.values()].sort((a, b) => {
    const ra = rank.get(sectionKey(a)) ?? Infinity, rb = rank.get(sectionKey(b)) ?? Infinity;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

export async function loadSectionOrder(userId: string): Promise<string[]> {
  const row = check(await supabase.from('profiles').select('storefront_design').eq('id', userId).single()) as { storefront_design: any };
  const order = row?.storefront_design?.section_order;
  return Array.isArray(order) ? order.filter((s: unknown) => typeof s === 'string') : [];
}

/** Writes just section_order into storefront_design, keeping every other key as stored. */
export async function saveSectionOrder(userId: string, order: string[]): Promise<void> {
  const row = check(await supabase.from('profiles').select('storefront_design').eq('id', userId).single()) as { storefront_design: any };
  const design = { ...(row?.storefront_design ?? {}), section_order: order };
  check(await supabase.from('profiles').update({ storefront_design: design, updated_at: nowISO() }).eq('id', userId));
}

/** Renames a section on every listing that uses it (any capitalisation). */
export async function renameSection(userId: string, from: string, to: string): Promise<void> {
  check(await supabase.from('menu_items').update({ category: to.trim(), updated_at: nowISO() })
    .eq('user_id', userId).ilike('category', from.trim().replace(/[\\%_]/g, '\\$&')));
}
