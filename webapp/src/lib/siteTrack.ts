import { supabase } from './supabase';

/**
 * The sign-up funnel's half of the website analytics (the marketing pages
 * use /assets/site-analytics.js). Same visitor/session ids and first-touch
 * attribution as the site — it's the same origin — so the admin Website
 * screen can follow a visitor from the homepage to a paid plan. Never throws.
 */
type SiteEvent = 'signup_view' | 'signup_done' | 'plan_view' | 'checkout_start';

function stored(kind: 'localStorage' | 'sessionStorage', key: string): string {
  try {
    const s = window[kind];
    let v = s.getItem(key);
    if (!v) { v = crypto.randomUUID(); s.setItem(key, v); }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

export function trackSite(event: SiteEvent, ref?: string): void {
  try {
    let attr: Record<string, string> = {};
    try { attr = JSON.parse(sessionStorage.getItem('bk_attr') || '{}') ?? {}; } catch { /* none */ }
    const q = new URLSearchParams(location.search);
    void supabase.rpc('log_site_event', {
      p_event: event,
      p_path: location.pathname,
      p_ref: ref ?? null,
      p_referrer: attr.referrer || document.referrer || null,
      p_source: attr.source || q.get('utm_source') || null,
      p_medium: attr.medium || q.get('utm_medium') || null,
      p_campaign: attr.campaign || q.get('utm_campaign') || null,
      p_ref_code: attr.ref || q.get('ref') || null,
      p_session: stored('sessionStorage', 'bk_sid'),
      p_visitor: stored('localStorage', 'bk_vid'),
    }).then(() => {}, () => {});
  } catch { /* analytics never breaks the app */ }
}
