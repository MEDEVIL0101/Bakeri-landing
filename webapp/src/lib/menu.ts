import { supabase, STORAGE_PUBLIC_URL } from './supabase';
import { check, ApiError } from './api';
import { isoNoMillis, newId, nowISO, up } from './format';
import type { BoxVariant, IntakeForm, ListingKind, ListingVariant, MenuItem, PreorderMode, Profile, SizeTier } from './types';

export const LISTING_KINDS: { kind: ListingKind; label: string; description: string }[] = [
  { kind: 'ready_now', label: 'Ready Now', description: 'In stock, ready to buy now' },
  { kind: 'preorder', label: 'Pre-order', description: 'Made to order for a future date' },
  { kind: 'custom', label: 'Custom Order', description: 'Buyers request a quote through your order form' },
  { kind: 'physical', label: 'Physical', description: 'You ship or deliver it to the buyer yourself' },
  { kind: 'digital', label: 'Digital Download', description: 'Instant download, nothing to ship' },
];

export function kindLabel(kind: ListingKind): string {
  return LISTING_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export interface MenuItemFull extends MenuItem {
  tiers: SizeTier[];
  boxVariants: BoxVariant[];
  listingVariants: ListingVariant[];
}

export async function listMenuItems(userId: string): Promise<MenuItemFull[]> {
  const [items, tiers, boxVariants, listingVariants] = await Promise.all([
    supabase.from('menu_items').select('*').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
    supabase.from('menu_item_size_tiers').select('*').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
    supabase.from('menu_item_variants').select('*').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
    supabase.from('listing_variants').select('*').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
  ]);
  const t = check(tiers) as SizeTier[];
  const b = check(boxVariants) as BoxVariant[];
  const l = check(listingVariants) as ListingVariant[];
  return (check(items) as MenuItem[]).map((m) => ({
    ...m,
    tiers: t.filter((x) => x.menu_item_id === m.id),
    boxVariants: b.filter((x) => x.menu_item_id === m.id),
    listingVariants: l.filter((x) => x.menu_item_id === m.id),
  }));
}

export async function listIntakeForms(userId: string): Promise<IntakeForm[]> {
  return check(await supabase.from('intake_forms').select('id, title').eq('user_id', userId).order('created_at')) as IntakeForm[];
}

export function menuImageURL(item: Pick<MenuItem, 'id' | 'user_id' | 'updated_at'>): string {
  return `${STORAGE_PUBLIC_URL}/menu-item-images/${up(item.user_id)}/${up(item.id)}.jpg?v=${Date.parse(item.updated_at) || 0}`;
}

export function variantImageURL(userId: string, itemId: string, variant: { id: string; updated_at?: string }): string {
  return `${STORAGE_PUBLIC_URL}/menu-item-images/${up(userId)}/${up(itemId)}/variants/${up(variant.id)}.jpg?v=${Date.parse(variant.updated_at ?? '') || 0}`;
}

// ── Image prep ────────────────────────────────────────────────────────────

/** Same as the iOS upload settings: longest side 900px, JPEG quality 0.65. */
export async function compressImage(file: File, maxSide = 900, quality = 0.65): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new ApiError('That file isn’t an image we can read. Try a JPEG or PNG.');
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('Couldn’t process that image.'))), 'image/jpeg', quality),
  );
}

// ── Save (mirrors AddEditMenuItemView.performSave) ────────────────────────

export interface TierDraft { id?: string; label: string; unit_count: number; price: number }
/** `image` is a newly picked photo (uploaded on save); `has_image` reflects what's stored. */
export interface BoxVariantDraft { id?: string; name: string; has_image?: boolean; image?: Blob | null }
export interface OptionDraft { id?: string; label: string; price: number; stock_qty: number; has_image?: boolean; image?: Blob | null }

export interface MenuDraft {
  name: string;
  item_description: string;
  category: string;
  unit: string;
  price: number;
  is_active: boolean;
  is_listed: boolean;
  listing_kind: ListingKind;
  available_qty_today: number;
  lead_days: number;
  preorder_mode: PreorderMode;
  preorder_dates: string[];
  preorder_weekday: number;
  preorder_cutoff: string | null;
  delivery_mode: 'default' | 'on' | 'off';
  delivery_fee: number;
  accepts_buyer_note: boolean;
  allergens: string;
  lead_time_note: string;
  shipping_fee: number;
  intake_form_id: string | null;
  recipe_ids: string[];
  recipe_names: string[];
  is_assorted_box: boolean;
  tiers: TierDraft[];
  box_variants: BoxVariantDraft[];
  has_variants: boolean;
  options: OptionDraft[];
  /** A Custom Order Form listing (iOS isFormListing) — name + intro + form only. */
  is_storefront_form: boolean;
  storefront_intro_title: string;
  storefront_intro_body: string;
  /** This form IS the whole storefront (profiles.storefront_listing_id). */
  use_as_site_body: boolean;
}

export interface SaveResult { id: string; unlistedForNoFulfillment: boolean; hidOthers: number }

/** iOS computedWeekdayReadyDate: the first `weekday` (1=Sun) after the cutoff. */
function weekdayReadyDate(weekday: number, cutoffISO: string): string {
  const d = new Date(cutoffISO);
  for (let i = 1; i <= 7; i++) {
    const c = new Date(d);
    c.setDate(d.getDate() + i);
    if (c.getDay() + 1 === weekday) return c.toISOString();
  }
  return d.toISOString();
}

export async function saveMenuItem(
  userId: string,
  draft: MenuDraft,
  profile: Profile | null,
  existing: MenuItemFull | undefined,
  allItems: MenuItemFull[],
  image: Blob | null,
  digitalFile: File | null,
): Promise<SaveResult> {
  const id = existing?.id ?? newId();
  const ts = nowISO();
  let isListed = draft.is_listed;
  let unlistedForNoFulfillment = false;

  // Food listings need somewhere to collect from or a delivery option.
  if (isListed && draft.listing_kind !== 'digital' && draft.listing_kind !== 'physical') {
    const hasPickup = !!profile?.pickup_address?.trim();
    if (!hasPickup && !profile?.delivery_enabled) { isListed = false; unlistedForNoFulfillment = true; }
  }

  const kind = draft.listing_kind;
  const row: Record<string, unknown> = {
    id,
    user_id: userId,
    name: draft.name.trim(),
    item_description: draft.item_description.trim(),
    category: draft.category,
    unit: draft.unit || 'pieces',
    recipe_ids: draft.recipe_ids,
    recipe_id: draft.recipe_ids[0] ?? null,
    linked_recipe_name: draft.recipe_names.length ? draft.recipe_names.join(', ') : null,
    is_active: draft.is_active,
    is_listed_in_marketplace: isListed,
    listing_kind: kind,
    available_qty_today: draft.available_qty_today,
    lead_days: draft.lead_days,
    max_preorder_quantity: kind === 'preorder' ? draft.available_qty_today : 0,
    accepts_buyer_note: draft.accepts_buyer_note,
    intake_form_id: draft.intake_form_id,
    allergens: draft.allergens.trim(),
    lead_time_note: draft.lead_time_note.trim(),
    shipping_fee: kind === 'physical' ? draft.shipping_fee : 0,
    is_assorted_box: draft.is_assorted_box,
    has_variants: draft.has_variants,
    has_image: image ? true : (existing?.has_image ?? false),
    is_storefront_form: kind === 'custom' && draft.is_storefront_form,
    storefront_intro_title: draft.storefront_intro_title.trim() || null,
    storefront_intro_body: draft.storefront_intro_body.trim() || null,
    updated_at: ts,
  };
  if (!existing) {
    row.sort_order = Math.max(-1, ...allItems.map((i) => i.sort_order)) + 1;
    row.created_at = ts;
  }

  if (!draft.is_assorted_box && !draft.has_variants) {
    row.default_price = draft.price;
    row.marketplace_price_from = draft.price;
  }

  if (kind === 'preorder') {
    row.preorder_schedule_mode = draft.preorder_mode;
    if (draft.preorder_mode === 'fixed_dates') {
      // yyyy-mm-dd → local noon, as ISO8601 WITHOUT fractional seconds:
      // iOS decodes these strings with a plain ISO8601DateFormatter, which
      // rejects "…:00.000Z" and would silently drop every date.
      const dates = [...draft.preorder_dates].sort().map((d) => isoNoMillis(new Date(`${d}T12:00`)));
      row.preorder_dates = dates;
      row.preorder_weekday = null;
      row.preorder_order_cutoff_date = null;
      row.use_drop_date = true;
      row.preorder_drop_date = dates[0] ?? null;
    } else if (draft.preorder_mode === 'weekday') {
      const cutoff = draft.preorder_cutoff ?? ts;
      row.preorder_dates = [];
      row.preorder_weekday = draft.preorder_weekday;
      row.preorder_order_cutoff_date = cutoff;
      row.use_drop_date = true;
      row.preorder_drop_date = weekdayReadyDate(draft.preorder_weekday, cutoff);
    } else {
      row.preorder_dates = [];
      row.preorder_weekday = null;
      row.preorder_order_cutoff_date = null;
      row.use_drop_date = false;
      row.preorder_drop_date = null;
    }
  } else {
    row.preorder_schedule_mode = 'fixed_dates';
    row.preorder_dates = [];
    row.preorder_weekday = null;
    row.preorder_order_cutoff_date = null;
    row.use_drop_date = false;
    row.preorder_drop_date = null;
  }

  row.is_delivery_available = draft.delivery_mode === 'on' ? true : draft.delivery_mode === 'off' ? false : !!profile?.delivery_enabled;
  row.delivery_fee = draft.delivery_mode === 'on' ? draft.delivery_fee : 0;

  let digitalPath: string | null | undefined;
  if (kind === 'digital') {
    if (digitalFile) {
      const ext = digitalFile.name.includes('.') ? digitalFile.name.split('.').pop()! : 'dat';
      digitalPath = `${up(userId)}/${up(id)}.${ext}`;
      row.digital_file_path = digitalPath;
    }
  } else {
    row.digital_file_path = null;
  }

  // Box tiers / variants and listing options: keep ids that still exist,
  // soft-delete the rest. Price-from is the lowest tier/option price.
  const tierRows = draft.is_assorted_box
    ? draft.tiers
        .filter((t) => t.label.trim() && t.unit_count > 0 && t.price > 0)
        .map((t, i) => ({ id: t.id ?? newId(), user_id: userId, menu_item_id: id, label: t.label.trim(), unit_count: t.unit_count, price: t.price, sort_order: i, updated_at: ts, deleted_at: null }))
    : [];
  // Give every new option/flavour its id up front so a freshly picked photo
  // can be uploaded under the same id the row is saved with.
  const boxVs = draft.box_variants.filter((v) => v.name.trim()).map((v) => ({ ...v, id: v.id ?? newId() }));
  const opts = draft.options.filter((o) => o.label.trim() && o.price > 0).map((o) => ({ ...o, id: o.id ?? newId() }));
  const boxVariantRows = draft.is_assorted_box
    ? boxVs
        .map((v, i) => ({ id: v.id, user_id: userId, menu_item_id: id, name: v.name.trim(), sort_order: i, has_image: !!(v.image || v.has_image), updated_at: ts, deleted_at: null }))
    : [];
  const optionRows = draft.has_variants
    ? opts
        .map((o, i) => ({ id: o.id, user_id: userId, menu_item_id: id, label: o.label.trim(), price: o.price, stock_qty: o.stock_qty, sort_order: i, has_image: !!(o.image || o.has_image), updated_at: ts, deleted_at: null }))
    : [];

  if (tierRows.length) {
    const low = Math.min(...tierRows.map((t) => t.price));
    row.default_price = low; row.marketplace_price_from = low;
  }
  if (optionRows.length) {
    const low = Math.min(...optionRows.map((o) => o.price));
    row.default_price = low; row.marketplace_price_from = low;
    if (kind === 'physical') row.available_qty_today = optionRows.reduce((s, o) => s + o.stock_qty, 0);
  }

  if (existing) check(await supabase.from('menu_items').update(row).eq('id', id));
  else check(await supabase.from('menu_items').insert(row));

  await syncChildren('menu_item_size_tiers', existing?.tiers ?? [], tierRows, ts);
  await syncChildren('menu_item_variants', existing?.boxVariants ?? [], boxVariantRows, ts);
  await syncChildren('listing_variants', existing?.listingVariants ?? [], optionRows, ts);

  // Option / flavour photos: menu-item-images/{USER}/{ITEM}/variants/{VARIANT}.jpg
  // (iOS SyncService.uploadListingVariantImage / uploadBoxVariantImage).
  const variantImages: { id: string; image: Blob }[] = [];
  if (draft.is_assorted_box) for (const v of boxVs) if (v.image) variantImages.push({ id: v.id, image: v.image });
  if (draft.has_variants) for (const o of opts) if (o.image) variantImages.push({ id: o.id, image: o.image });
  for (const v of variantImages) {
    const { error } = await supabase.storage.from('menu-item-images')
      .upload(`${up(userId)}/${up(id)}/variants/${up(v.id)}.jpg`, v.image, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
    if (error) throw new ApiError(`Saved, but an option photo didn’t upload: ${error.message || 'please try again'}`);
  }

  // Custom Order Form as the whole storefront: point the profile at it and
  // hide every other listed item (iOS claimSiteBody), or release it.
  let hidOthers = 0;
  if (kind === 'custom' && draft.is_storefront_form && draft.use_as_site_body && isListed) {
    check(await supabase.from('profiles').update({ storefront_listing_id: id, updated_at: ts }).eq('id', userId));
    const others = allItems.filter((m) => m.id !== id && m.is_listed_in_marketplace);
    if (others.length) {
      check(await supabase.from('menu_items').update({ is_listed_in_marketplace: false, updated_at: ts }).in('id', others.map((m) => m.id)));
      hidOthers = others.length;
    }
  } else if (profile?.storefront_listing_id && profile.storefront_listing_id.toLowerCase() === id.toLowerCase()) {
    check(await supabase.from('profiles').update({ storefront_listing_id: null, updated_at: ts }).eq('id', userId));
  }

  if (image) {
    const { error } = await supabase.storage
      .from('menu-item-images')
      .upload(`${up(userId)}/${up(id)}.jpg`, image, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' });
    if (error) throw new ApiError(`Saved, but the photo didn’t upload: ${error.message || 'please try again'}`);
  }
  if (digitalFile && digitalPath) {
    const { error } = await supabase.storage
      .from('digital-products')
      .upload(digitalPath, digitalFile, { upsert: true, contentType: digitalFile.type || 'application/octet-stream' });
    if (error) throw new ApiError(`Saved, but the file didn’t upload: ${error.message || 'please try again'}`);
  }

  return { id, unlistedForNoFulfillment, hidOthers };
}

async function syncChildren(table: string, before: { id: string }[], after: { id: string }[], ts: string) {
  const keep = new Set(after.map((r) => r.id));
  const removed = before.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (removed.length) check(await supabase.from(table).update({ deleted_at: ts, updated_at: ts }).in('id', removed));
  if (after.length) check(await supabase.from(table).upsert(after, { onConflict: 'id' }));
}

export async function setListed(item: MenuItem, listed: boolean): Promise<void> {
  check(await supabase.from('menu_items').update({ is_listed_in_marketplace: listed, updated_at: nowISO() }).eq('id', item.id));
}

export async function setStock(item: MenuItem, qty: number): Promise<void> {
  const patch: Record<string, unknown> = { available_qty_today: qty, updated_at: nowISO() };
  if (item.listing_kind === 'preorder') patch.max_preorder_quantity = qty;
  check(await supabase.from('menu_items').update(patch).eq('id', item.id));
}

export async function deleteMenuItem(item: MenuItemFull): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('menu_items').update({ deleted_at: ts, updated_at: ts }).eq('id', item.id));
}

/** Persist a new order of listings (sort_order 0..n). */
export async function reorderMenu(items: MenuItem[]): Promise<void> {
  const ts = nowISO();
  await Promise.all(
    items.map((it, i) => supabase.from('menu_items').update({ sort_order: i, updated_at: ts }).eq('id', it.id)),
  );
}
