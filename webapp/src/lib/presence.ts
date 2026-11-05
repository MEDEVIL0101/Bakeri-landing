import { supabase } from './supabase';

/**
 * "Online in the web app" for Bakeri Admin (web_presence; the iPhone app has
 * its own heartbeat in user_presence). Once a minute while this tab is open
 * and visible, plus right away when it comes back into view. Best-effort —
 * a failed beat is simply skipped.
 */
export function startWebPresence(userId: string): () => void {
  let last = 0;
  const beat = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 20_000) return;
    last = Date.now();
    void supabase.from('web_presence')
      .upsert({ user_id: userId, last_seen_at: new Date().toISOString(), user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'user_id' })
      .then(() => undefined, () => undefined);
  };
  beat();
  const timer = window.setInterval(beat, 60_000);
  const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}

/** "/orders/3f2a…/edit" → "orders_detail_edit"; "/" → "home". */
export function screenKey(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
    .map((p) => (/^[0-9a-f-]{8,}$/i.test(p) || /^\d+$/.test(p) ? 'detail' : p.toLowerCase().replace(/[^a-z0-9]+/g, '_')));
  return (parts.join('_') || 'home').slice(0, 60);
}

/** Logs a screen open for Bakeri Admin's Usage screen. Fire-and-forget. */
export function logScreen(pathname: string): void {
  void supabase.from('app_events')
    .insert({ screen: screenKey(pathname), platform: 'web' })
    .then(() => undefined, () => undefined);
}
