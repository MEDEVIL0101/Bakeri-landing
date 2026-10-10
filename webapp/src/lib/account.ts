import { supabase, appURL } from './supabase';
import { callFunction, check, ApiError } from './api';
import { nowISO } from './format';

// ── Name / password / deletion / feedback (iOS ProfileView + sheets) ──────

export async function saveUserName(userId: string, name: string): Promise<void> {
  check(await supabase.from('profiles').update({ user_name: name.trim(), updated_at: nowISO() }).eq('id', userId));
}

export async function updatePassword(pw: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) throw new ApiError(error.message);
}

/** Same as AuthService.scheduleAccountDeletion: a 30-day cooling-off row, then sign out. */
export async function scheduleAccountDeletion(userId: string): Promise<Date> {
  const when = new Date(Date.now() + 30 * 86400_000);
  check(await supabase.from('account_deletion_requests').upsert({ user_id: userId, scheduled_for: when.toISOString() }, { onConflict: 'user_id' }));
  await supabase.auth.signOut();
  return when;
}

/** Signing back in cancels a pending deletion (iOS checkAndCancelPendingDeletion). */
export async function cancelPendingDeletion(userId: string): Promise<boolean> {
  const { data } = await supabase.from('account_deletion_requests').select('user_id').eq('user_id', userId);
  if (!data?.length) return false;
  await supabase.from('account_deletion_requests').delete().eq('user_id', userId);
  return true;
}

export const FEEDBACK_CATEGORIES = ['General Feedback', 'Bug Report', 'Feature Request', 'Other'] as const;

export async function sendFeedback(userId: string, category: string, message: string): Promise<void> {
  check(await supabase.from('feedback').insert({
    user_id: userId, category, message: message.trim(), app_version: 'web', os_version: navigator.userAgent.slice(0, 200),
  }));
}

// ── Referrals (ReferralService) ───────────────────────────────────────────

export interface ReferralDashboard {
  eligible: boolean;
  code: string | null;
  currency: string;
  referred_count: number;
  selling_count: number;
  pending_cents: number;
  available_cents: number;
  paid_cents: number;
  next_payout_date: string | null;
  referred_bakers: { name: string; joined_at: string; status: string; lifetime_commission_cents: number }[];
}

export async function referralDashboard(): Promise<ReferralDashboard> {
  return check(await supabase.rpc('referral_dashboard')) as ReferralDashboard;
}

export async function getOrCreateReferralCode(): Promise<string> {
  return check(await supabase.rpc('get_or_create_referral_code')) as string;
}

export function referralLink(code: string): string {
  return `https://bakeriapp.com/?ref=${code}#apply`;
}

// ── Direct Deposit (PaymentService+Connect) ───────────────────────────────

export const CONNECT_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
];

export async function connectStatus(userId: string): Promise<{ complete: boolean; accountId: string | null }> {
  try {
    const r = await callFunction<{ complete: boolean; accountId?: string | null }>('check-connect-account-status', {});
    return { complete: !!r.complete, accountId: r.accountId ?? null };
  } catch {
    // Same fallback as iOS: the cached profile columns.
    const { data } = await supabase.from('profiles').select('stripe_connect_account_id, stripe_connect_onboarding_complete').eq('id', userId).maybeSingle();
    return { complete: !!data?.stripe_connect_onboarding_complete, accountId: data?.stripe_connect_account_id ?? null };
  }
}

/** Starts (or resumes) Stripe onboarding. Stripe sends the vendor back to /app/payouts. */
export async function connectOnboardingURL(country: string): Promise<string> {
  const r = await callFunction<{ url: string }>('create-connect-account-link', {
    country,
    returnUrl: appURL('payouts?stripe=return'),
    refreshUrl: appURL('payouts?stripe=refresh'),
  });
  if (!r?.url) throw new ApiError('Stripe didn’t return a setup link. Please try again.');
  return r.url;
}

export async function disconnectStripe(): Promise<void> {
  await callFunction('disconnect-connect-account', {});
}

export interface PayoutSummary {
  available_cents: number;
  pending_cents: number;
  instant_available_cents: number;
  currency: string;
  has_bank_account: boolean;
  has_debit_card: boolean;
  dashboard_login_url: string;
  recent_transactions: { id: string; type: string; amount_cents: number; net_cents: number; fee_cents: number; status: string; created_at: string; available_on: string }[];
}

export async function payoutSummary(): Promise<PayoutSummary> {
  return callFunction<PayoutSummary>('get-baker-payout-summary', {});
}

export function txnLabel(type: string): string {
  switch (type) {
    case 'charge': case 'payment': return 'Sale';
    case 'refund': case 'payment_refund': return 'Refund';
    case 'payout': return 'Payout';
    case 'adjustment': return 'Adjustment';
    case 'application_fee': case 'application_fee_refund': return 'Bakeri fee';
    default: return type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }
}

export function formatCents(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol' }).format(cents / 100);
}

// ── Shop settings: link, pickup address, shipping ─────────────────────────

export interface ShopSettings {
  profile_slug: string;
  pickup_address: string;
  pickup_city: string;
  pickup_province: string;
  pickup_postal_code: string;
  shipping_free_over_threshold: number;
  shipping_additional_item_percent: number;
}

export async function loadShopSettings(userId: string): Promise<ShopSettings> {
  const row = check(await supabase.from('profiles')
    .select('profile_slug, pickup_address, pickup_city, pickup_province, pickup_postal_code, shipping_free_over_threshold, shipping_additional_item_percent')
    .eq('id', userId).single()) as any;
  return {
    profile_slug: row.profile_slug ?? '',
    pickup_address: row.pickup_address ?? '',
    pickup_city: row.pickup_city ?? '',
    pickup_province: row.pickup_province ?? '',
    pickup_postal_code: row.pickup_postal_code ?? '',
    shipping_free_over_threshold: Number(row.shipping_free_over_threshold ?? 0),
    shipping_additional_item_percent: Number(row.shipping_additional_item_percent ?? 100),
  };
}

export async function savePickupAddress(userId: string, s: Pick<ShopSettings, 'pickup_address' | 'pickup_city' | 'pickup_province' | 'pickup_postal_code'>): Promise<void> {
  check(await supabase.from('profiles').update({
    pickup_address: s.pickup_address.trim(), pickup_city: s.pickup_city.trim(),
    pickup_province: s.pickup_province.trim(), pickup_postal_code: s.pickup_postal_code.trim(), updated_at: nowISO(),
  }).eq('id', userId));
}

export async function saveShippingRules(userId: string, freeOver: number, additionalPct: number): Promise<void> {
  check(await supabase.from('profiles').update({
    shipping_free_over_threshold: Math.max(0, freeOver),
    shipping_additional_item_percent: Math.min(100, Math.max(0, additionalPct)),
    updated_at: nowISO(),
  }).eq('id', userId));
}

export async function saveItemShipping(items: { id: string; shipping_fee: number; shipping_always_full_price: boolean }[]): Promise<void> {
  const ts = nowISO();
  for (const it of items) {
    check(await supabase.from('menu_items').update({ shipping_fee: Math.max(0, it.shipping_fee), shipping_always_full_price: it.shipping_always_full_price, updated_at: ts }).eq('id', it.id));
  }
}

/** EditStorefrontSlugSheet.slugify */
export function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function slugTaken(userId: string, slug: string): Promise<boolean> {
  const rows = check(await supabase.from('profiles').select('profile_slug').eq('profile_slug', slug).neq('id', userId)) as unknown[];
  return rows.length > 0;
}

export async function slugSuggestions(userId: string, base: string, city: string, province: string): Promise<string[]> {
  const c = slugify(city), p = slugify(province);
  const out: string[] = [];
  if (c) out.push(`${base}-${c}`);
  if (p) out.push(`${base}-${p}`);
  if (c && p) out.push(`${base}-${c}-${p}`);
  out.push(`${base}2`, `${base}3`, `${base}-bakery`, `${base}-bakes`, `the-${base}`);
  const taken = check(await supabase.from('profiles').select('profile_slug').in('profile_slug', out).neq('id', userId)) as { profile_slug: string }[];
  const set = new Set(taken.map((t) => t.profile_slug));
  return out.filter((s) => !set.has(s)).slice(0, 4);
}

export async function saveSlug(userId: string, slug: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ profile_slug: slug, profile_slug_is_custom: true, updated_at: nowISO() }).eq('id', userId);
  if (error) {
    if ((error as any).code === '23505') throw new ApiError('That link is already taken. Try another.', '23505');
    throw new ApiError('Couldn’t save. Please try again.');
  }
}
