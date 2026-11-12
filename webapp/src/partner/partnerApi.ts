import { supabase } from '../lib/supabase';
import { callFunction, check } from '../lib/api';

/**
 * Community Growth Partners — people who bring vendors to Bakerï without
 * running a shop. Everything here reads the partner_* RPCs and the
 * growth-partner-connect function (20261111000002_growth_partners.sql).
 */

export interface PartnerMe {
  user_id: string;
  name: string;
  email: string;
  company: string | null;
  country: string;
  status: 'active' | 'paused' | 'ended';
  payouts_ready: boolean;
  has_payout_account: boolean;
  agreed_guidelines_at: string | null;
  code: string | null;
  commission_rate: number;
  commission_months: number | null;
  has_shop: boolean;
  /** The partner's link-in-bio page (bakeriapp.com/<slug>), once they've made one. */
  link_page_slug: string | null;
  created_at: string;
}

export interface PartnerReferral {
  id: string;
  shop: string;
  slug: string | null;
  joined_at: string;
  plan_status: 'paying' | 'trialing' | 'inactive';
  plan_tier: string | null;
  status: string;
  rate: number;
  earns_until: string | null;
  earned_cents: number;
}

export interface PartnerDashboard {
  code: string | null;
  days: number;
  traffic: {
    visitors: number; page_views: number; signup_views: number; signups: number;
    daily: { day: string; visitors: number }[];
    campaigns: { campaign: string; visitors: number; signups: number }[];
  };
  funnel: { signed_up: number; signed_up_period: number; trialing: number; paying: number; inactive: number };
  money: {
    currency: string; pending_cents: number; available_cents: number; paid_cents: number;
    lifetime_cents: number; period_cents: number; next_payout_date: string; minimum_cents: number;
    monthly: { month: string; cents: number }[];
  };
  referrals: PartnerReferral[];
  payouts: { id: string; amount_cents: number; currency: string; status: string; created_at: string; failure_reason: string | null }[];
  leads: { total: number; new: number; contacted: number; interested: number; signed_up: number; follow_ups_due: number };
}

export type LeadStatus = 'new' | 'contacted' | 'replied' | 'interested' | 'signed_up' | 'not_interested';

export interface PartnerLead {
  id: string;
  shop_name: string;
  contact_name: string | null;
  instagram: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  status: LeadStatus;
  notes: string;
  last_contacted_at: string | null;
  next_follow_up: string | null;
  converted_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export const LEAD_STATUSES: { value: LeadStatus; label: string; tone: 'neutral' | 'blue' | 'green' | 'gold' | 'red' | 'ink' }[] = [
  { value: 'new', label: 'To contact', tone: 'neutral' },
  { value: 'contacted', label: 'Contacted', tone: 'blue' },
  { value: 'replied', label: 'Replied', tone: 'blue' },
  { value: 'interested', label: 'Interested', tone: 'gold' },
  { value: 'signed_up', label: 'Signed up', tone: 'green' },
  { value: 'not_interested', label: 'Not interested', tone: 'neutral' },
];

export async function loadPartnerMe(): Promise<PartnerMe | null> {
  const { data, error } = await supabase.rpc('partner_me');
  if (error) return null;
  return (data as PartnerMe | null) ?? null;
}

export async function loadPartnerDashboard(days: number): Promise<PartnerDashboard> {
  return check(await supabase.rpc('partner_dashboard', { p_days: days })) as PartnerDashboard;
}

/** Creates the partner's link-in-bio page; returns its slug. */
export async function createLinkPage(slug: string): Promise<string> {
  return check(await supabase.rpc('partner_create_link_page', { p_slug: slug })) as string;
}

export async function agreeGuidelines(): Promise<void> {
  check(await supabase.rpc('partner_agree_guidelines'));
}

export async function loadLeads(): Promise<PartnerLead[]> {
  return check(await supabase.from('partner_leads').select('*').order('updated_at', { ascending: false })) as PartnerLead[];
}

export type SaveLeadResult =
  | { status: 'saved'; lead: PartnerLead }
  | { status: 'existing_vendor' | 'claimed' | 'invalid'; message: string };

export async function saveLead(lead: Partial<PartnerLead> & { touched?: boolean }): Promise<SaveLeadResult> {
  return check(await supabase.rpc('partner_save_lead', { p_lead: lead })) as SaveLeadResult;
}

export async function deleteLead(id: string): Promise<void> {
  check(await supabase.from('partner_leads').delete().eq('id', id));
}

export async function payoutStatus(): Promise<{ ready: boolean; has_account: boolean; details_submitted?: boolean; currently_due?: string[]; disabled_reason?: string | null }> {
  return callFunction('growth-partner-connect', { action: 'status' });
}

export async function payoutOnboardingURL(country?: string): Promise<string> {
  const r = await callFunction<{ url: string }>('growth-partner-connect', {
    action: 'onboard', country, returnUrl: `${window.location.origin}/app/partner/payouts?connected=1`,
  });
  return r.url;
}

export async function payoutDashboardURL(): Promise<string> {
  return (await callFunction<{ url: string }>('growth-partner-connect', { action: 'dashboard' })).url;
}

/** Where a partner's links point. Campaign tags ride on utm_campaign, which the site already records. */
export const LINK_TARGETS = [
  { key: 'home', label: 'Bakerï homepage', base: 'https://bakeriapp.com/' },
  { key: 'pricing', label: 'Plans & free trial', base: 'https://bakeriapp.com/app/plan' },
  { key: 'creators', label: 'For creators', base: 'https://bakeriapp.com/for-creators.html' },
] as const;

export function partnerLink(code: string, base: string = LINK_TARGETS[0].base, campaign?: string): string {
  const u = new URL(base);
  u.searchParams.set('ref', code);
  const c = (campaign ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (c) u.searchParams.set('utm_campaign', c);
  return u.toString();
}

export const pctLabel = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

export function termLabel(months: number | null): string {
  return months ? `for each vendor’s first ${months} months` : 'for as long as each vendor stays on a paid plan';
}
