import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthProvider';
import { Button, ErrorBanner, Field, Input, PageHeader, Spinner, useToast } from '../components/ui';
import { SettingsGroup } from '../pages/settings/SettingsPage';
import { LOGO } from '../lib/brand';

/**
 * Optional two-factor sign-in with an authenticator app (Supabase TOTP MFA).
 * Once a vendor turns it on, a password alone only gets an aal1 session:
 * the app asks for the 6-digit code, and the database refuses their data
 * until it's entered (restrictive RLS, migration 20261031000004_mfa_enforcement).
 */

function cleanCode(v: string) {
  return v.replace(/\D/g, '').slice(0, 6);
}

/** Shown in place of the app after a password sign-in when 2FA is on. */
export function MfaChallengePage() {
  const { refreshMfa, signOut, session } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const { data: factors, error: fe } = await supabase.auth.mfa.listFactors();
      if (fe) throw fe;
      const factor = factors.totp.find((f) => f.status === 'verified');
      if (!factor) throw new Error('No authenticator app is set up on this account.');
      const { error: ve } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (ve) throw ve;
      await refreshMfa();
    } catch (err: any) {
      setError(/invalid|expired/i.test(err?.message ?? '') ? 'That code didn’t work. Check your authenticator app and try the newest code.' : err?.message ?? 'Something went wrong. Please try again.');
      setCode('');
    }
    setBusy(false);
  }

  return (
    <div className="auth-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="auth-card">
        <h1>Enter your code</h1>
        <p className="muted">Open your authenticator app and enter the 6-digit code for Bakeri{session?.user.email ? ` (${session.user.email})` : ''}.</p>
        <form onSubmit={submit} className="stack">
          <Field label="6-digit code">
            <Input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code}
              onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="123456" className="mfa-code" />
          </Field>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" loading={busy} disabled={code.length !== 6} className="btn-block">Verify</Button>
        </form>
      </div>
      <div className="auth-footer">
        Lost your phone? Email <a href="mailto:hello@bakeriapp.com">hello@bakeriapp.com</a> · <button type="button" className="link-btn" onClick={() => signOut()}>Log out</button>
      </div>
    </div>
  );
}

type Enrolling = { factorId: string; qr: string; secret: string };

/** Settings → Two-factor authentication. */
export function TwoFactorPage() {
  const { refreshMfa } = useAuth();
  const toast = useToast();
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { setError(error.message); setFactorId(null); return; }
    setFactorId(data.totp.find((f) => f.status === 'verified')?.id ?? null);
  }
  useEffect(() => { load(); }, []);

  async function start() {
    setBusy(true); setError(null);
    try {
      // Clear out any half-finished setup first — Supabase allows one unverified factor at a time.
      const { data: all } = await supabase.auth.mfa.listFactors();
      for (const f of all?.all ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Bakeri ${new Date().toISOString().slice(0, 10)}`, issuer: 'Bakeri' });
      if (error) throw error;
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } catch (err: any) {
      setError(err?.message ?? 'Couldn’t start setup. Please try again.');
    }
    setBusy(false);
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!enrolling || code.length !== 6) return;
    setBusy(true); setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code });
    setBusy(false);
    if (error) { setError('That code didn’t work. Try the newest code from your authenticator app.'); setCode(''); return; }
    setEnrolling(null);
    await load();
    await refreshMfa();
    toast('Two-factor authentication is on');
  }

  async function turnOff() {
    if (!factorId) return;
    if (!window.confirm('Turn off two-factor authentication? You’ll only need your password to log in.')) return;
    setBusy(true); setError(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) { setError(error.message); return; }
    await supabase.auth.refreshSession();
    await load();
    await refreshMfa();
    toast('Two-factor authentication is off');
  }

  return (
    <div className="page page-narrow">
      <PageHeader back={<Link to="/settings" className="back-link">Settings</Link>} title="Two-factor authentication" />
      {factorId === undefined ? <Spinner /> : enrolling ? (
        <SettingsGroup heading="Set up your authenticator app">
          <div className="settings-row stack">
            <ol className="mfa-steps">
              <li>Open an authenticator app — Google Authenticator, 1Password, Authy or your iPhone’s Passwords app.</li>
              <li>Scan this code, or enter the key below.</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            <img className="mfa-qr" src={enrolling.qr} alt="QR code for your authenticator app" />
            <p className="small muted">Key: <code className="mfa-secret">{enrolling.secret}</code></p>
            <form onSubmit={confirm} className="stack">
              <Field label="6-digit code">
                <Input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code}
                  onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="123456" className="mfa-code" />
              </Field>
              {error && <ErrorBanner message={error} />}
              <div className="mfa-actions">
                <Button type="submit" loading={busy} disabled={code.length !== 6}>Turn on</Button>
                <Button type="button" variant="ghost" onClick={() => { setEnrolling(null); setError(null); }}>Cancel</Button>
              </div>
            </form>
          </div>
        </SettingsGroup>
      ) : (
        <SettingsGroup heading="Status" footer={factorId
          ? 'You’ll be asked for a code from your authenticator app each time you log in on the web or in the app.'
          : 'Add a second step to logging in: a 6-digit code from an authenticator app on your phone. Even if someone gets your password, they can’t get into your shop.'}>
          <div className="settings-row">
            <span className="grow">
              <span className="settings-title">{factorId ? 'On' : 'Off'}</span>
              <span className="row-sub">{factorId ? 'Authenticator app' : 'Recommended'}</span>
            </span>
            {factorId
              ? <Button variant="secondary" loading={busy} onClick={turnOff}>Turn off</Button>
              : <Button loading={busy} onClick={start}>Set up</Button>}
          </div>
          {error && <div className="settings-row"><ErrorBanner message={error} /></div>}
        </SettingsGroup>
      )}
    </div>
  );
}
