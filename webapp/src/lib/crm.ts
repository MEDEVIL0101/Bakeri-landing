import { supabase } from './supabase';
import { check } from './api';
import { effectiveTotal } from './orders';
import type { CampaignSend, Contact, Order } from './types';

/**
 * Customer outreach (Harvey 2026-11-02): what we know about each customer —
 * their orders, what they bought, the emails they've had and opened — and the
 * combinable filters a campaign's audience is built from. Everything is worked
 * out here in the browser from rows the vendor can already read; the send
 * function only ever gets the resulting contact ids and re-checks them.
 */

export async function listCampaignSends(): Promise<CampaignSend[]> {
  // RLS (baker_read_own_campaign_sends) limits this to the vendor's own campaigns.
  return check(
    await supabase
      .from('baker_campaign_sends')
      .select('id, campaign_id, contact_id, email, status, sent_at, opened_at, open_count, clicked_at, click_count')
      .order('sent_at', { ascending: false }),
  ) as CampaignSend[];
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10);

/** Orders that belong to this customer: same email, or same phone (orders typed in without an email). */
export function ordersFor(c: Contact, orders: Order[]): Order[] {
  const email = c.email.trim().toLowerCase();
  const phone = digits(c.phone);
  return orders
    .filter((o) => (o.customer_email ?? '').trim().toLowerCase() === email || (phone.length >= 7 && digits(o.customer_phone) === phone))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A product as it appears across orders: the listing id when there is one, else the item's name. */
export function productKey(item: { menu_item_id: string | null; custom_name: string }): string {
  return item.menu_item_id ? `id:${item.menu_item_id}` : `name:${item.custom_name.trim().toLowerCase()}`;
}

const isCancelled = (o: Order) => o.status === 'Cancelled' || ['cancelled', 'declined', 'refunded', 'expired'].includes(o.marketplace_status ?? '');

export interface CustomerProfile {
  contact: Contact;
  orders: Order[];
  orderCount: number;
  spent: number;
  lastOrderAt: string | null;
  products: Set<string>;
  sends: CampaignSend[];
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  lastEmailAt: string | null;
}

export function buildProfiles(contacts: Contact[], orders: Order[], sends: CampaignSend[]): Map<string, CustomerProfile> {
  const sendsBy = new Map<string, CampaignSend[]>();
  for (const s of sends) {
    if (!s.contact_id) continue;
    (sendsBy.get(s.contact_id) ?? sendsBy.set(s.contact_id, []).get(s.contact_id)!).push(s);
  }
  const out = new Map<string, CustomerProfile>();
  for (const c of contacts) {
    const mine = ordersFor(c, orders).filter((o) => !isCancelled(o));
    const products = new Set<string>();
    for (const o of mine) for (const it of o.order_items ?? []) if (!it.deleted_at) products.add(productKey(it));
    const delivered = (sendsBy.get(c.id) ?? []).filter((s) => s.status === 'sent');
    out.set(c.id, {
      contact: c,
      orders: mine,
      orderCount: mine.length,
      spent: mine.reduce((sum, o) => sum + effectiveTotal(o), 0),
      lastOrderAt: mine[0]?.created_at ?? null,
      products,
      sends: delivered,
      emailsSent: delivered.length,
      emailsOpened: delivered.filter((s) => s.opened_at).length,
      emailsClicked: delivered.filter((s) => s.clicked_at).length,
      lastEmailAt: delivered[0]?.sent_at ?? null,
    });
  }
  return out;
}

/** Every product anyone has ordered, most-ordered first (for the "Bought" filter). */
export function productCatalog(orders: Order[], names: Map<string, string>): { key: string; label: string; count: number }[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const o of orders) {
    if (isCancelled(o)) continue;
    for (const it of o.order_items ?? []) {
      if (it.deleted_at) continue;
      const key = productKey(it);
      const label = (it.menu_item_id && names.get(it.menu_item_id)) || it.custom_name || 'Unnamed item';
      const row = m.get(key) ?? { label, count: 0 };
      row.count += 1;
      m.set(key, row);
    }
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
}

// ── Audience filters ─────────────────────────────────────────────────────

export interface AudienceFilter {
  /** Whether they've ordered at all. */
  ordered: 'any' | 'yes' | 'no';
  /** At least this many orders (when ordered = yes). */
  minOrders: number;
  /** When their last order was. */
  lastOrder: 'any' | 'within' | 'before';
  lastOrderDays: number;
  /** Bought any of these products (productKey values). */
  products: string[];
  /** Has any of these tags. */
  tags: string[];
  /** Joined through any of these sources (CONTACT_SOURCES keys). */
  sources: string[];
  /** Engagement with earlier emails. */
  engagement: 'any' | 'opened' | 'clicked' | 'never_opened' | 'never_emailed';
}

export const EMPTY_FILTER: AudienceFilter = {
  ordered: 'any', minOrders: 1, lastOrder: 'any', lastOrderDays: 90,
  products: [], tags: [], sources: [], engagement: 'any',
};

/** What a campaign stores in baker_campaigns.audience. */
export interface Audience {
  /** Filters plus hand changes, or only hand-picked people. */
  mode: 'filter' | 'picked';
  filter: AudienceFilter;
  /** Matched by the filter but unticked by hand. */
  excluded: string[];
  /** Added by hand whether or not they match. */
  added: string[];
  /** The final list, frozen when saved. */
  contact_ids: string[];
  label: string;
}

const DAY = 86400000;

export function matches(p: CustomerProfile, f: AudienceFilter, now = Date.now()): boolean {
  if (f.ordered === 'yes' && p.orderCount < Math.max(1, f.minOrders)) return false;
  if (f.ordered === 'no' && p.orderCount > 0) return false;
  if (f.lastOrder !== 'any') {
    if (!p.lastOrderAt) return false;
    const ago = (now - new Date(p.lastOrderAt).getTime()) / DAY;
    if (f.lastOrder === 'within' && ago > f.lastOrderDays) return false;
    if (f.lastOrder === 'before' && ago <= f.lastOrderDays) return false;
  }
  if (f.products.length && !f.products.some((k) => p.products.has(k))) return false;
  if (f.tags.length && !f.tags.some((t) => (p.contact.tags ?? []).includes(t))) return false;
  if (f.sources.length && !f.sources.includes(p.contact.source)) return false;
  switch (f.engagement) {
    case 'opened': if (!p.emailsOpened) return false; break;
    case 'clicked': if (!p.emailsClicked) return false; break;
    case 'never_opened': if (!p.emailsSent || p.emailsOpened) return false; break;
    case 'never_emailed': if (p.emailsSent) return false; break;
  }
  return true;
}

export function isEmptyFilter(f: AudienceFilter): boolean {
  return f.ordered === 'any' && f.lastOrder === 'any' && !f.products.length && !f.tags.length && !f.sources.length && f.engagement === 'any';
}

/** "Ordered 2+ times · last order over 90 days ago · bought Lemon loaf". */
export function describeFilter(f: AudienceFilter, productLabel: (k: string) => string, sourceLabel: (s: string) => string): string {
  if (isEmptyFilter(f)) return 'Everyone on your mailing list';
  const parts: string[] = [];
  if (f.ordered === 'yes') parts.push(f.minOrders > 1 ? `Ordered ${f.minOrders}+ times` : 'Has ordered');
  if (f.ordered === 'no') parts.push('Never ordered');
  if (f.lastOrder === 'within') parts.push(`last order in the past ${f.lastOrderDays} days`);
  if (f.lastOrder === 'before') parts.push(`no order in ${f.lastOrderDays}+ days`);
  if (f.products.length) parts.push(`bought ${list(f.products.map(productLabel))}`);
  if (f.tags.length) parts.push(`tagged ${list(f.tags)}`);
  if (f.sources.length) parts.push(`joined by ${list(f.sources.map(sourceLabel))}`);
  const eng = { opened: 'opened an earlier email', clicked: 'clicked an earlier email', never_opened: 'never opened an email', never_emailed: 'never emailed' } as const;
  if (f.engagement !== 'any') parts.push(eng[f.engagement]);
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function list(xs: string[]): string {
  if (xs.length <= 2) return xs.join(' or ');
  return `${xs.slice(0, 2).join(', ')} or ${xs.length - 2} more`;
}

// ── Campaign results ─────────────────────────────────────────────────────

export interface CampaignStats { sent: number; failed: number; opened: number; clicked: number; openRate: number; clickRate: number }

export function campaignStats(sends: CampaignSend[]): CampaignStats {
  const sent = sends.filter((s) => s.status === 'sent');
  const opened = sent.filter((s) => s.opened_at).length;
  const clicked = sent.filter((s) => s.clicked_at).length;
  return {
    sent: sent.length,
    failed: sends.filter((s) => s.status === 'failed').length,
    opened, clicked,
    openRate: sent.length ? opened / sent.length : 0,
    clickRate: sent.length ? clicked / sent.length : 0,
  };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
