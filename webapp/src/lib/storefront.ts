import { supabase } from './supabase';
import { check, ApiError } from './api';
import { newId, nowISO, up } from './format';

// ── Shapes (mirror the iOS models / Supabase columns) ─────────────────────

export type BlockType = 'menu' | 'physical' | 'digital' | 'links' | 'about' | 'faq' | 'policies' | 'hours' | 'emailCapture';
export interface LayoutBlock { type: BlockType; hidden: boolean }

/** StorefrontBlock.defaultLayout — must match the web page and the DB default. */
export const DEFAULT_LAYOUT: LayoutBlock[] = (['menu', 'physical', 'digital', 'links', 'about', 'faq', 'policies', 'hours'] as BlockType[])
  .map((type) => ({ type, hidden: false }));

export const BLOCK_LABELS: Record<BlockType, string> = {
  menu: 'Menu', physical: 'Ships to You', digital: 'Digital Downloads', links: 'Links', about: 'About',
  faq: 'FAQ', policies: 'Store Policies', hours: 'Pickup Hours', emailCapture: 'Mailing List Signup',
};

export interface DayHours { closed: boolean; open: string; close: string }
export type WeekHours = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours>;
export const WEEK_DAYS: (keyof WeekHours)[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type LinkStyle = 'list' | 'photoCard' | 'richCard';
export interface Link {
  id: string;
  section: string;
  label: string;
  url: string;
  style: LinkStyle;
  image_url: string | null;
  outline_style: 'none' | 'border' | 'glow';
  shake: boolean;
  target_type: 'url' | 'product' | 'file';
  linked_listing_id: string | null;
}
export interface FAQ { id: string; question: string; answer: string }

export const SOCIAL_PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'X', 'Pinterest', 'LinkedIn', 'WhatsApp'];
export const THEMES = ['Classic', 'Macaron', 'Birthday', 'Tart', 'Sprinkle', 'Ember', 'Sage', 'Blueberry', 'Honey', 'Fall'];
export const PATTERNS = ['Standard', 'Polka Dot', 'Stripes', 'Gingham', 'Pumpkins'];

// v2 (profiles.storefront_design — Models/StorefrontDesign.swift)
export interface CardColors { background?: string; title?: string; button?: string; text?: string }
export type V2CardType = 'leadMagnet' | 'menu' | 'products' | 'links' | 'about' | 'info' | 'emailCapture';
export interface V2Block {
  type: V2CardType;
  hidden?: boolean;
  title?: string;
  nav?: boolean;
  nav_label?: string;
  nav_color?: string;
  nav_text_color?: string;
  nav_border?: boolean;
  nav_border_color?: string;
  nav_shake?: boolean;
  colors?: CardColors;
  image_url?: string;
  parts_hidden?: string[];
  listing_id?: string;
  heading?: string;
  body?: string;
}
export interface LinkDesign { background?: string; text?: string; border?: boolean; border_color?: string; glow?: boolean; glow_color?: string }
export interface StorefrontDesign {
  blocks?: V2Block[];
  colors?: { accent?: string; ink?: string; tint?: string };
  display_font?: string;
  corners?: string;
  background?: { mode?: 'theme' | 'image_top' | 'image_full'; color?: string; image_url?: string; focus?: { x: number; y: number } };
  identity?: { colors?: CardColors };
  focus?: unknown;
  links?: Record<string, LinkDesign>;
}

export const V2_CARDS: { type: V2CardType; label: string; navByDefault: boolean; parts?: { key: string; label: string }[] }[] = [
  { type: 'leadMagnet', label: 'Free Download', navByDefault: false },
  { type: 'menu', label: 'Menu', navByDefault: true },
  { type: 'products', label: 'Products', navByDefault: true, parts: [{ key: 'physical', label: 'Physical products' }, { key: 'digital', label: 'Digital downloads' }] },
  { type: 'links', label: 'Links', navByDefault: true },
  { type: 'about', label: 'About', navByDefault: false },
  { type: 'info', label: 'Before You Order', navByDefault: true, parts: [{ key: 'policies', label: 'Store policies' }, { key: 'faq', label: 'FAQ' }, { key: 'hours', label: 'Pickup hours' }] },
  { type: 'emailCapture', label: 'Mailing List Signup', navByDefault: false },
];
export const V2_FONTS = ['Archivo', 'Shrikhand', 'Cormorant Garamond', 'Fraunces', 'Playfair Display', 'DM Serif Display', 'Abril Fatface', 'Lilita One', 'Pacifico', 'Baloo 2'];

export function v2DefaultTitle(t: V2CardType, firstName: string): string {
  return {
    leadMagnet: 'Free download', menu: 'Shop my Menu', products: 'Shop my Products', links: `More from ${firstName}`,
    about: `Meet ${firstName}`, info: 'Before you order', emailCapture: 'Join my list',
  }[t];
}

/** The draft the builder edits. Everything here is published together. */
export interface StorefrontDraft {
  business_name: string;
  bio: string;
  location: string;
  selected_theme: string;
  background_pattern: string;
  about_heading: string;
  about_story: string;
  store_policies: string;
  neighbourhood: string;
  pickup_note: string;
  pickup_hours_json: WeekHours;
  email_capture_heading: string;
  email_capture_body: string;
  email_capture_display_style: 'inline' | 'popup';
  email_capture_deliverable_listing_id: string | null;
  header_signup_enabled: boolean;
  header_signup_label: string;
  storefront_block_layout: LayoutBlock[];
  storefront_design: StorefrontDesign | null;
  links: Link[];
  faqs: FAQ[];
  /** Newly picked images, as data: URLs, uploaded on publish. */
  images: { logo?: string; header?: string; portrait?: string };
}

export interface StorefrontData {
  draft: StorefrontDraft;
  published: StorefrontDraft;
  /** Public profile as the storefront page receives it (promo banner etc.). */
  publicProfile: Record<string, unknown>;
  listings: any[];
  menuItems: { id: string; name: string; listing_kind: string; is_listed_in_marketplace: boolean; is_lead_magnet: boolean }[];
  slug: string | null;
  firstName: string;
  updatedAt: string;
}

const PROFILE_COLUMNS = [
  'business_name', 'bio', 'location', 'selected_theme', 'background_pattern', 'about_heading', 'about_story',
  'store_policies', 'neighbourhood', 'pickup_note', 'pickup_hours_json', 'email_capture_heading', 'email_capture_body',
  'email_capture_display_style', 'email_capture_deliverable_listing_id', 'header_signup_enabled', 'header_signup_label',
  'storefront_block_layout', 'storefront_design', 'profile_slug', 'user_name', 'updated_at',
] as const;

function defaultDay(): DayHours { return { closed: true, open: '09:00', close: '17:00' }; }

function normaliseHours(raw: any): WeekHours {
  const h = {} as WeekHours;
  for (const d of WEEK_DAYS) h[d] = { ...defaultDay(), ...(raw && typeof raw === 'object' ? raw[d] : {}) };
  return h;
}

// ── Load ──────────────────────────────────────────────────────────────────

export async function loadStorefront(userId: string): Promise<StorefrontData> {
  const [profileRes, linksRes, faqsRes, rpcRes, menuRes] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS.join(', ')).eq('id', userId).single(),
    supabase.from('baker_links').select('id, section, label, url, style, image_url, outline_style, shake, target_type, linked_listing_id')
      .eq('user_id', userId).is('deleted_at', null).order('sort_order'),
    supabase.from('baker_faqs').select('id, question, answer').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
    supabase.rpc('get_baker_web_profile_by_id', { p_user_id: userId }),
    supabase.from('menu_items').select('id, name, listing_kind, is_listed_in_marketplace, is_lead_magnet').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
  ]);
  const p = check(profileRes) as any;
  const links = (check(linksRes) as any[]).map((l) => ({
    ...l, style: l.style ?? 'list', outline_style: l.outline_style ?? 'none', shake: !!l.shake, target_type: l.target_type ?? 'url',
  })) as Link[];
  const faqs = check(faqsRes) as FAQ[];
  const rpc = (rpcRes.data ?? {}) as any;

  let layout: LayoutBlock[] = Array.isArray(p.storefront_block_layout) && p.storefront_block_layout.length
    ? p.storefront_block_layout : DEFAULT_LAYOUT;
  // The live page shows the signup whenever it has a heading, even when the
  // layout array doesn't list it — and since every listed block is moved
  // after it, it ends up first. Mirror that so the builder shows what
  // visitors see (and saving pins it there explicitly).
  if ((p.email_capture_heading ?? '').trim() && !layout.some((b) => b.type === 'emailCapture')) {
    layout = [{ type: 'emailCapture', hidden: false }, ...layout];
  }

  const draft: StorefrontDraft = {
    business_name: p.business_name ?? '',
    bio: p.bio ?? '',
    location: p.location ?? '',
    selected_theme: p.selected_theme || 'Classic',
    background_pattern: p.background_pattern || 'Standard',
    about_heading: p.about_heading ?? '',
    about_story: p.about_story ?? '',
    store_policies: p.store_policies ?? '',
    neighbourhood: p.neighbourhood ?? '',
    pickup_note: p.pickup_note ?? '',
    pickup_hours_json: normaliseHours(p.pickup_hours_json),
    email_capture_heading: p.email_capture_heading ?? '',
    email_capture_body: p.email_capture_body ?? '',
    email_capture_display_style: p.email_capture_display_style === 'popup' ? 'popup' : 'inline',
    email_capture_deliverable_listing_id: p.email_capture_deliverable_listing_id ?? null,
    header_signup_enabled: !!p.header_signup_enabled,
    header_signup_label: p.header_signup_label || 'Sign up',
    storefront_block_layout: layout,
    storefront_design: p.storefront_design ?? null,
    links,
    faqs,
    images: {},
  };
  return {
    draft: structuredClone(draft),
    published: draft,
    publicProfile: rpc.profile ?? {},
    listings: rpc.listings ?? [],
    menuItems: (check(menuRes) as any[]) ?? [],
    slug: p.profile_slug ?? null,
    firstName: (p.user_name ?? '').trim().split(/\s+/)[0] || 'me',
    updatedAt: p.updated_at,
  };
}

// ── Diff ──────────────────────────────────────────────────────────────────

function hoursEqualForSave(a: WeekHours, b: WeekHours) { return JSON.stringify(a) === JSON.stringify(b); }

export function changedSections(d: StorefrontDraft, p: StorefrontDraft): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (d.business_name !== p.business_name || d.bio !== p.bio || d.location !== p.location || Object.keys(d.images).length) out.push('Profile');
  if (d.selected_theme !== p.selected_theme || d.background_pattern !== p.background_pattern) out.push('Theme');
  if (d.about_heading !== p.about_heading || d.about_story !== p.about_story) out.push('About');
  if (d.store_policies !== p.store_policies) out.push('Policies');
  if (d.neighbourhood !== p.neighbourhood || d.pickup_note !== p.pickup_note || !hoursEqualForSave(d.pickup_hours_json, p.pickup_hours_json)) out.push('Pickup hours');
  if (d.email_capture_heading !== p.email_capture_heading || d.email_capture_body !== p.email_capture_body
    || d.email_capture_display_style !== p.email_capture_display_style || d.email_capture_deliverable_listing_id !== p.email_capture_deliverable_listing_id
    || d.header_signup_enabled !== p.header_signup_enabled || d.header_signup_label !== p.header_signup_label) out.push('Mailing list');
  if (!same(d.storefront_block_layout, p.storefront_block_layout)) out.push('Layout');
  if (!same(d.storefront_design, p.storefront_design)) out.push('New design');
  if (!same(d.links, p.links)) out.push('Links');
  if (!same(d.faqs, p.faqs)) out.push('FAQ');
  return out;
}

// ── Publish (mirrors StorefrontPublisher.publish) ─────────────────────────

async function dataURLToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

function normalisedURL(raw: string): string {
  const s = raw.trim();
  if (!s || /^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export async function publishStorefront(userId: string, d: StorefrontDraft, p: StorefrontDraft): Promise<void> {
  const uid = up(userId);
  // Images first, so the profile's updated_at (the storefront's ?v= cache
  // buster) moves after the new bytes are in place.
  const uploads: [keyof StorefrontDraft['images'], string, string][] = [
    ['logo', 'business-logos', `${uid}/logo.jpg`],
    ['header', 'storefront-headers', `${uid}/header.jpg`],
    ['portrait', 'baker-portraits', `${uid}/portrait.jpg`],
  ];
  for (const [key, bucket, path] of uploads) {
    const dataURL = d.images[key];
    if (!dataURL) continue;
    const { error } = await supabase.storage.from(bucket).upload(path, await dataURLToBlob(dataURL), {
      upsert: true, contentType: 'image/jpeg', cacheControl: '300',
    });
    if (error) throw new ApiError(`The ${key} photo didn’t upload: ${error.message}`);
  }

  check(
    await supabase.from('profiles').update({
      business_name: d.business_name.trim(),
      bio: d.bio.trim(),
      location: d.location.trim(),
      selected_theme: d.selected_theme,
      background_pattern: d.background_pattern,
      about_heading: d.about_heading,
      about_story: d.about_story,
      store_policies: d.store_policies,
      neighbourhood: d.neighbourhood,
      pickup_note: d.pickup_note,
      pickup_hours_json: d.pickup_hours_json,
      email_capture_heading: d.email_capture_heading,
      email_capture_body: d.email_capture_body,
      email_capture_display_style: d.email_capture_display_style,
      email_capture_deliverable_listing_id: d.email_capture_deliverable_listing_id,
      header_signup_enabled: d.header_signup_enabled,
      header_signup_label: d.header_signup_label,
      storefront_block_layout: d.storefront_block_layout,
      ...(JSON.stringify(d.storefront_design) !== JSON.stringify(p.storefront_design) ? { storefront_design: d.storefront_design } : {}),
      updated_at: nowISO(),
    }).eq('id', userId),
  );

  // Links / FAQs: same delete-then-insert as BakerLinkService/BakerFAQService.saveLinks.
  if (JSON.stringify(d.links) !== JSON.stringify(p.links)) {
    const rows = d.links
      .filter((l) => l.section.trim() && l.label.trim() && (l.target_type === 'product' ? !!l.linked_listing_id : !!l.url.trim()))
      .map((l, i) => ({
        id: l.id,
        user_id: userId,
        section: l.section.trim(),
        label: l.label.trim(),
        url: l.target_type === 'url' ? normalisedURL(l.url) : l.target_type === 'file' ? l.url : '',
        sort_order: i,
        style: l.style,
        image_url: l.image_url,
        outline_style: l.outline_style,
        shake: l.shake,
        target_type: l.target_type,
        linked_listing_id: l.linked_listing_id,
      }));
    check(await supabase.from('baker_links').delete().eq('user_id', userId));
    if (rows.length) check(await supabase.from('baker_links').insert(rows));
  }
  if (JSON.stringify(d.faqs) !== JSON.stringify(p.faqs)) {
    const rows = d.faqs
      .filter((f) => f.question.trim() && f.answer.trim())
      .map((f, i) => ({ id: f.id, user_id: userId, question: f.question.trim(), answer: f.answer.trim(), sort_order: i }));
    check(await supabase.from('baker_faqs').delete().eq('user_id', userId));
    if (rows.length) check(await supabase.from('baker_faqs').insert(rows));
  }
}

// ── Builder image uploads (link cards, v2 card/background photos) ─────────

/**
 * Link-card and v2 builder photos go to the public link-card-images bucket.
 * The user folder there is LOWERCASE (unlike the logo/header buckets) — see
 * SyncService.uploadLinkCardImage. A fresh name each time keeps a trial
 * photo from ever replacing what the live page shows.
 */
export async function uploadBuilderImage(userId: string, blob: Blob): Promise<string> {
  const path = `${userId.toLowerCase()}/${newId().toLowerCase()}.jpg`;
  const { error } = await supabase.storage.from('link-card-images').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new ApiError(`Photo didn’t upload: ${error.message}`);
  return supabase.storage.from('link-card-images').getPublicUrl(path).data.publicUrl;
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ── v2 seeding (port of StorefrontDesign.seedBlocks) ──────────────────────

const V2_DEFAULT_ORDER: V2CardType[] = ['leadMagnet', 'menu', 'products', 'links', 'about', 'info', 'emailCapture'];

export function seedV2Blocks(v1: LayoutBlock[], deliverableListingId: string | null, heading: string, body: string): V2Block[] {
  const hasDeliverable = !!deliverableListingId;
  const order: V2CardType[] = [];
  const blocks = new Map<V2CardType, V2Block>();
  for (const entry of v1) {
    const t: V2CardType =
      entry.type === 'menu' ? 'menu'
      : entry.type === 'physical' || entry.type === 'digital' ? 'products'
      : entry.type === 'links' ? 'links'
      : entry.type === 'about' ? 'about'
      : entry.type === 'emailCapture' ? (hasDeliverable ? 'leadMagnet' : 'emailCapture')
      : 'info';
    if (!blocks.has(t)) { blocks.set(t, { type: t, hidden: true }); order.push(t); }
    const b = blocks.get(t)!;
    if (!entry.hidden) b.hidden = false;
    if (entry.hidden && (t === 'products' || t === 'info')) b.parts_hidden = [...(b.parts_hidden ?? []), entry.type];
  }
  if (hasDeliverable && blocks.has('leadMagnet')) {
    const lead = blocks.get('leadMagnet')!;
    lead.listing_id = deliverableListingId!.toLowerCase();
    if (heading) lead.heading = heading;
    if (body) lead.body = body;
    if (!blocks.has('emailCapture')) blocks.set('emailCapture', { type: 'emailCapture', hidden: true });
  }
  V2_DEFAULT_ORDER.forEach((t, i) => {
    if (order.includes(t)) return;
    if (!blocks.has(t)) blocks.set(t, { type: t, hidden: false });
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(V2_DEFAULT_ORDER[j]);
      if (k !== -1) { at = k + 1; break; }
    }
    order.splice(at, 0, t);
  });
  return order.map((t) => blocks.get(t)!).filter(Boolean);
}

export function ensureDesign(d: StorefrontDraft): StorefrontDesign {
  if (d.storefront_design?.blocks?.length) return d.storefront_design;
  return {
    ...(d.storefront_design ?? {}),
    blocks: seedV2Blocks(d.storefront_block_layout, d.email_capture_deliverable_listing_id, d.email_capture_heading, d.email_capture_body),
  };
}

// ── Preview payload (same shape as the public RPC) ────────────────────────

export function previewPayload(data: StorefrontData, d: StorefrontDraft, userId: string) {
  const nameOf = (id: string | null) => data.menuItems.find((m) => m.id === id)?.name ?? null;
  const leadOf = (id: string | null) => data.menuItems.find((m) => m.id === id)?.is_lead_magnet ?? null;
  const { images, links, faqs, ...fields } = d;
  return {
    profile: {
      ...data.publicProfile,
      ...fields,
      id: userId,
      profile_slug: data.slug,
      updated_at: data.updatedAt,
      __preview_logo_data_url: images.logo,
      __preview_header_data_url: images.header,
      __preview_portrait_data_url: images.portrait,
    },
    listings: data.listings,
    faqs: faqs.filter((f) => f.question.trim()),
    links: links
      .filter((l) => l.label.trim())
      .map((l, i) => ({
        ...l,
        url: l.target_type === 'url' ? normalisedURL(l.url) : l.url,
        sort_order: i,
        target_listing_name: l.target_type === 'product' ? nameOf(l.linked_listing_id) : null,
        target_listing_is_lead_magnet: l.target_type === 'product' ? leadOf(l.linked_listing_id) : null,
      })),
  };
}

// ── Local draft persistence (a page refresh keeps unpublished edits) ─────

const draftKey = (uid: string) => `bakeri.storefrontDraft.${uid}`;

export function saveLocalDraft(uid: string, d: StorefrontDraft, basedOn: string) {
  try { localStorage.setItem(draftKey(uid), JSON.stringify({ d, basedOn })); } catch { /* storage full or blocked */ }
}

/** Only restores a draft made against the currently published version. */
export function loadLocalDraft(uid: string, basedOn: string): StorefrontDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(uid));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v?.basedOn === basedOn ? (v.d as StorefrontDraft) : null;
  } catch { return null; }
}

export function clearLocalDraft(uid: string) {
  try { localStorage.removeItem(draftKey(uid)); } catch { /* ignore */ }
}

export function newLink(section: string): Link {
  return { id: newId(), section, label: '', url: '', style: 'list', image_url: null, outline_style: 'none', shake: false, target_type: 'url', linked_listing_id: null };
}
export function newFAQ(): FAQ { return { id: newId(), question: '', answer: '' }; }
