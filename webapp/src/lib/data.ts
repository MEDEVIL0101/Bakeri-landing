import { supabase } from './supabase';
import { callFunction, check, ApiError } from './api';
import { newId, nowISO, up } from './format';
import type { BakingTask, Campaign, Contact, Recipe, RecipeIngredient, UnavailableDate } from './types';

// ── Contacts / mailing list (mirror BakerContactService) ──────────────────

export const CONTACT_SOURCES: Record<string, string> = {
  order: 'Order', popup: 'Popup signup', inline: 'Storefront signup', header: 'Header signup',
  lead_magnet: 'Free download', manual: 'Added by you',
  course: 'Course', club: 'Club',
};

export async function listContacts(userId: string): Promise<Contact[]> {
  return check(
    await supabase.from('baker_contacts').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  ) as Contact[];
}

/** True when this email is already one of the vendor's contacts. */
export async function hasContact(userId: string, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return true;
  const { data } = await supabase.from('baker_contacts').select('id').eq('user_id', userId).eq('email', e).limit(1);
  return (data ?? []).length > 0;
}

/** A storefront customer, added from their order (source 'order'), like the app's prompt. */
export async function addOrderContact(userId: string, o: { id: string; customer_email: string; customer_name: string; customer_phone: string }): Promise<void> {
  const email = o.customer_email.trim().toLowerCase();
  if (!email) return;
  check(
    await supabase.from('baker_contacts').upsert(
      { user_id: userId, email, name: o.customer_name?.trim() || null, phone: o.customer_phone?.trim() || null,
        source: 'order', first_order_id: o.id, updated_at: nowISO() },
      { onConflict: 'user_id,email' },
    ),
  );
}

/** Upsert on (user_id, email) — never touches unsubscribed_at. */
export async function addContact(userId: string, c: { email: string; name: string; phone: string }): Promise<void> {
  const email = c.email.trim().toLowerCase();
  if (!email) throw new ApiError('Enter an email address.');
  check(
    await supabase.from('baker_contacts').upsert(
      {
        user_id: userId,
        email,
        name: c.name.trim() || null,
        phone: c.phone.trim() || null,
        source: 'manual',
        updated_at: nowISO(),
      },
      { onConflict: 'user_id,email' },
    ),
  );
}

export async function getContact(id: string): Promise<Contact | null> {
  return check(await supabase.from('baker_contacts').select('*').eq('id', id).maybeSingle()) as Contact | null;
}

export async function setSubscribed(contact: Contact, subscribed: boolean): Promise<void> {
  check(
    await supabase
      .from('baker_contacts')
      .update({ unsubscribed_at: subscribed ? null : nowISO(), updated_at: nowISO() })
      .eq('id', contact.id),
  );
}

export async function deleteContact(contact: Contact): Promise<void> {
  check(await supabase.from('baker_contacts').delete().eq('id', contact.id));
}

// ── Campaigns (mirror CampaignService) ────────────────────────────────────

export async function listCampaigns(userId: string): Promise<Campaign[]> {
  return check(
    await supabase.from('baker_campaigns').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  ) as Campaign[];
}

export async function saveCampaignDraft(userId: string, c: Partial<Campaign> & { subject: string; body_text: string }): Promise<string> {
  const id = c.id ?? newId();
  check(
    await supabase.from('baker_campaigns').upsert({
      id,
      user_id: userId,
      subject: c.subject,
      body_text: c.body_text,
      image_url: c.image_url ?? null,
      cta_label: c.cta_label || null,
      cta_url: c.cta_url || null,
      cta_listing_id: c.cta_listing_id || null,
      audience: c.audience ?? null,
      body_html: c.body_html ?? null,
      updated_at: nowISO(),
    }),
  );
  return id;
}

export async function sendCampaign(id: string): Promise<{ sent: number; failed: number }> {
  const res = await callFunction<{ ok?: boolean; sent?: number; failed?: number; error?: string }>('send-baker-campaign', { campaign_id: id });
  if (!res?.ok) throw new ApiError(res?.error ?? 'Send failed');
  return { sent: res.sent ?? 0, failed: res.failed ?? 0 };
}

/** A copy of the campaign to the vendor's own email only — nothing is recorded as sent. */
export async function sendCampaignTest(id: string): Promise<string> {
  const res = await callFunction<{ ok?: boolean; to?: string; error?: string }>('send-baker-campaign', { campaign_id: id, test: true });
  if (!res?.ok) throw new ApiError(res?.error ?? 'Test send failed');
  return res.to ?? 'your email';
}

// ── Customer tags & notes ─────────────────────────────────────────────────

export async function setContactTags(contactIds: string[], change: (tags: string[]) => string[], contacts: Contact[]): Promise<void> {
  for (const c of contacts.filter((x) => contactIds.includes(x.id))) {
    const next = [...new Set(change(c.tags ?? []).map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    check(await supabase.from('baker_contacts').update({ tags: next, updated_at: nowISO() }).eq('id', c.id));
  }
}

export async function setContactNotes(id: string, notes: string): Promise<void> {
  check(await supabase.from('baker_contacts').update({ notes: notes.trim() || null, updated_at: nowISO() }).eq('id', id));
}

export async function deleteCampaign(id: string): Promise<void> {
  check(await supabase.from('baker_campaigns').delete().eq('id', id));
}

// ── Schedule ──────────────────────────────────────────────────────────────

export async function listTasks(userId: string): Promise<BakingTask[]> {
  return check(
    await supabase.from('baking_tasks').select('*').eq('user_id', userId).is('deleted_at', null).order('due_date'),
  ) as BakingTask[];
}

export async function saveTask(userId: string, t: Partial<BakingTask> & { title: string; due_date: string }): Promise<void> {
  const ts = nowISO();
  const row = {
    id: t.id ?? newId(),
    user_id: userId,
    title: t.title,
    due_date: t.due_date,
    notes: t.notes ?? '',
    color_name: t.color_name ?? 'gold',
    is_completed: t.is_completed ?? false,
    order_id: t.order_ids?.[0] ?? t.order_id ?? null,
    order_ids: t.order_ids ?? [],
    recipe_id: t.recipe_id ?? null,
    updated_at: ts,
    ...(t.id ? {} : { created_at: ts }),
  };
  check(await supabase.from('baking_tasks').upsert(row, { onConflict: 'id' }));
}

export async function setTaskDone(t: BakingTask, done: boolean): Promise<void> {
  check(await supabase.from('baking_tasks').update({ is_completed: done, updated_at: nowISO() }).eq('id', t.id));
}

export async function deleteTask(t: BakingTask): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('baking_tasks').update({ deleted_at: ts, updated_at: ts }).eq('id', t.id));
}

export async function listUnavailableDates(userId: string): Promise<UnavailableDate[]> {
  return check(await supabase.from('baker_unavailable_dates').select('*').eq('user_id', userId).order('date')) as UnavailableDate[];
}

export async function toggleUnavailable(userId: string, date: string, existing?: UnavailableDate): Promise<void> {
  if (existing) check(await supabase.from('baker_unavailable_dates').delete().eq('id', existing.id));
  else check(await supabase.from('baker_unavailable_dates').insert({ user_id: userId, date }));
}

// ── Recipes ───────────────────────────────────────────────────────────────

export async function listRecipes(userId: string): Promise<Recipe[]> {
  return check(
    await supabase.from('recipes').select('*').eq('user_id', userId).is('deleted_at', null).order('name'),
  ) as Recipe[];
}

export async function getRecipe(id: string): Promise<{ recipe: Recipe; ingredients: RecipeIngredient[] } | null> {
  const recipe = check(await supabase.from('recipes').select('*').eq('id', id).maybeSingle()) as Recipe | null;
  if (!recipe || recipe.deleted_at) return null;
  const ingredients = check(
    await supabase.from('recipe_ingredients').select('*').eq('recipe_id', id).is('deleted_at', null).order('sort_order'),
  ) as RecipeIngredient[];
  return { recipe, ingredients };
}

/** recipe-images is a private bucket — read through a short-lived signed URL. */
export async function recipeImageURL(r: Recipe): Promise<string | null> {
  if (!r.has_image) return null;
  const { data } = await supabase.storage.from('recipe-images').createSignedUrl(`${up(r.user_id)}/${up(r.id)}.jpg`, 3600);
  return data?.signedUrl ?? null;
}

export interface IngredientDraft { id?: string; name: string; volume_amount: number; volume_unit: string; grams_per_cup: number; notes: string }

export async function saveRecipe(
  userId: string,
  r: Omit<Recipe, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at' | 'has_image'> & { id?: string },
  ingredients: IngredientDraft[],
  before: RecipeIngredient[],
  image: Blob | null,
  hadImage: boolean,
): Promise<string> {
  const id = r.id ?? newId();
  const ts = nowISO();
  const row = {
    id,
    user_id: userId,
    name: r.name.trim(),
    yield_quantity: r.yield_quantity,
    yield_unit: r.yield_unit,
    prep_time_minutes: r.prep_time_minutes,
    bake_time_minutes: r.bake_time_minutes,
    instructions: r.instructions,
    notes: r.notes,
    tags: r.tags,
    is_favorite: r.is_favorite,
    has_image: image ? true : hadImage,
    updated_at: ts,
    ...(r.id ? {} : { created_at: ts }),
  };
  check(await supabase.from('recipes').upsert(row, { onConflict: 'id' }));

  const rows = ingredients
    .filter((i) => i.name.trim())
    .map((i, idx) => ({
      id: i.id ?? newId(),
      user_id: userId,
      recipe_id: id,
      name: i.name.trim(),
      volume_amount: i.volume_amount,
      volume_unit: i.volume_unit,
      grams_per_cup: i.grams_per_cup,
      notes: i.notes,
      sort_order: idx,
      updated_at: ts,
      deleted_at: null,
    }));
  const keep = new Set(rows.map((x) => x.id));
  const removed = before.filter((b) => !keep.has(b.id)).map((b) => b.id);
  if (removed.length) check(await supabase.from('recipe_ingredients').update({ deleted_at: ts, updated_at: ts }).in('id', removed));
  if (rows.length) check(await supabase.from('recipe_ingredients').upsert(rows, { onConflict: 'id' }));

  if (image) {
    const { error } = await supabase.storage
      .from('recipe-images')
      .upload(`${up(userId)}/${up(id)}.jpg`, image, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw new ApiError(`Saved, but the photo didn’t upload: ${error.message || 'please try again'}`);
  }
  return id;
}

export async function deleteRecipe(r: Recipe): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('recipes').update({ deleted_at: ts, updated_at: ts }).eq('id', r.id));
  check(await supabase.from('recipe_ingredients').update({ deleted_at: ts, updated_at: ts }).eq('recipe_id', r.id).is('deleted_at', null));
}
