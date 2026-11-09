/**
 * The referral code a visitor arrived with: the homepage keeps it for the
 * visit (sessionStorage 'bakeri_ref') and for 30 days on the device
 * (localStorage 'bakeri_ref_kept'), so someone who taps a vendor's link today
 * and signs up next week is still credited to that vendor.
 */
const KEEP_MS = 30 * 86400000;

export function rememberedReferralCode(): string {
  try {
    const visit = sessionStorage.getItem('bakeri_ref');
    if (visit) return visit;
    const attr = JSON.parse(sessionStorage.getItem('bk_attr') || '{}') as { ref?: string };
    if (attr.ref) return attr.ref;
    const kept = JSON.parse(localStorage.getItem('bakeri_ref_kept') || 'null') as { code?: string; at?: number } | null;
    if (kept?.code && kept.at && Date.now() - kept.at < KEEP_MS) return kept.code;
  } catch { /* private mode */ }
  return '';
}

export function keepReferralCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (!c) return;
  try {
    sessionStorage.setItem('bakeri_ref', c);
    localStorage.setItem('bakeri_ref_kept', JSON.stringify({ code: c, at: Date.now() }));
  } catch { /* private mode */ }
}
