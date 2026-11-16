import { LOGO } from '../lib/brand';
import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { nowISO } from '../lib/format';
import { Button, ErrorBanner, Field, Input } from '../components/ui';
import { useAuth } from './AuthProvider';

/**
 * Shown when a signed-in account has no profile row yet (signed up on the
 * web). Creates the row from the sign-up metadata, same fallback as iOS
 * ProfileService. The DB trigger assigns profile_slug from business_name.
 * The rest of setup (logo, Direct Deposit, terms) stays in the app's
 * VendorSetupFlow, which still runs because vendor_setup_completed_at is
 * left unset.
 */
export function SetupPage() {
  const { session, refreshProfile, signOut } = useAuth();
  const meta = (session?.user.user_metadata ?? {}) as Record<string, string>;
  const [name, setName] = useState(meta.full_name ?? '');
  const [business, setBusiness] = useState(meta.bakery_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Business name already used for someone's storefront address: up to 3
  // free alternatives to tap (check_business_name).
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true); setError(null); setSuggestions(null);
    const { data: check } = await supabase.rpc('check_business_name', { p_name: business.trim() });
    const result = check as { taken?: boolean; suggestions?: string[] } | null;
    if (result?.taken) { setSuggestions(result.suggestions ?? []); setBusy(false); return; }
    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id,
      user_name: name.trim(),
      business_name: business.trim(),
      updated_at: nowISO(),
    });
    if (error) { setError(error.message); setBusy(false); return; }
    await refreshProfile();
    setBusy(false);
  }

  return (
    <div className="auth-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="auth-card">
        <h1>Welcome to Bakeri</h1>
        <p className="muted">Tell us about your business to get started.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Your name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Business name" hint="This becomes your storefront link, e.g. bakeriapp.com/your-business.">
            <Input required value={business} onChange={(e) => { setBusiness(e.target.value); setSuggestions(null); }} />
          </Field>
          {suggestions && (
            <div className="name-taken" role="alert">
              <p className="name-taken-title">A user with that name already exists.</p>
              {suggestions.length > 0 && <p className="name-taken-sub">Try these or select a new name:</p>}
              <div className="name-chips">
                {suggestions.map((sug) => (
                  <button key={sug} type="button" className="name-chip" onClick={() => { setBusiness(sug); setSuggestions(null); }}>{sug}</button>
                ))}
              </div>
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <Button type="submit" loading={busy} className="btn-block">Continue</Button>
        </form>
      </div>
      <div className="auth-footer">
        Signed in as {session?.user.email} · <button className="link-btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
