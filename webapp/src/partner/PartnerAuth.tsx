import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { EmailOtpType } from '@supabase/supabase-js';
import { AuthLayout, friendlyAuthError, PasswordRules, passwordRules } from '../auth/AuthPages';
import { useAuth } from '../auth/AuthProvider';
import { Button, ErrorBanner, Field, Input, Spinner } from '../components/ui';
import { supabase } from '../lib/supabase';
import { agreeGuidelines, pctLabel, termLabel } from './partnerApi';

const APPLY_URL = 'https://bakeriapp.com/community-growth-partners.html#apply';

/** Growth Partner sign-in — the vendor log-in's twin, landing on /partner. */
export function PartnerLoginPage() {
  const { session, partner, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;
  const target = from?.startsWith('/partner') ? from : '/partner';

  if (session && justSignedIn) return <Navigate to={target} replace />;
  if (session) {
    return (
      <AuthLayout title="You’re already signed in" subtitle={<>Signed in as <strong>{session.user.email}</strong>.</>}>
        <div className="stack">
          <Button className="btn-block" onClick={() => navigate(partner ? target : '/', { replace: true })}>
            {partner ? 'Open my partner dashboard' : 'Continue'}
          </Button>
          <Button variant="secondary" className="btn-block" onClick={() => signOut()}>Use a different account</Button>
        </div>
      </AuthLayout>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setJustSignedIn(true);
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setJustSignedIn(false); setError(friendlyAuthError(error.message)); }
  }

  return (
    <AuthLayout
      title="Growth Partner sign in"
      subtitle="Your referral links, sign-ups, outreach and payouts."
      footer={<div className="stack-sm center">
        <span>Not a partner yet? <a href={APPLY_URL}>Apply to the program</a></span>
        <span>Run a shop on Bakerï? <Link to="/login">Vendor log in</Link></span>
      </div>}
    >
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy} className="btn-block">Sign in</Button>
        <Link to="/forgot-password" className="center small">Forgot your password?</Link>
      </form>
    </AuthLayout>
  );
}

/**
 * The approval email's link: /partner/welcome?token_hash=…&type=invite|recovery|magiclink.
 * Signs in with the one-time token, sets a password (new accounts), and
 * agrees to the partner guidelines once.
 */
export function PartnerWelcomePage() {
  const { session, partner, refreshPartner, setRecovering } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = (params.get('type') ?? 'invite') as EmailOtpType;
  const needsPassword = type === 'invite' || type === 'recovery';
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verified, setVerified] = useState(!tokenHash);
  const started = useRef(false);

  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenHash || started.current) return;
    started.current = true;
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      if (error) setVerifyError(error.message);
      setVerified(true);
      refreshPartner();
    });
  }, [tokenHash, type, refreshPartner]);

  if (!verified || session === undefined) {
    return <AuthLayout title="Welcome"><Spinner label="Opening your partner account…" /></AuthLayout>;
  }

  if (!session) {
    return (
      <AuthLayout title="That link didn’t work" footer={<Link to="/partner/login">Growth Partner sign in</Link>}>
        <p>{verifyError ? `${verifyError}. ` : ''}Sign-in links work once and expire after 24 hours.</p>
        <p className="muted small">Sign in with your password, or choose “Forgot your password?” to get a fresh link.</p>
        <Link to="/partner/login" className="btn btn-primary btn-block">Go to sign in</Link>
      </AuthLayout>
    );
  }

  if (partner === undefined) return <AuthLayout title="Welcome"><Spinner /></AuthLayout>;
  if (!partner) {
    return (
      <AuthLayout title="No partner account here" footer={<a href={APPLY_URL}>Apply to the program</a>}>
        <p>{session.user.email} isn’t set up as a Community Growth Partner.</p>
        <Link to="/" className="btn btn-secondary btn-block">Go to Bakerï</Link>
      </AuthLayout>
    );
  }
  if (!needsPassword && partner.agreed_guidelines_at) return <Navigate to="/partner" replace />;

  const rulesMet = !needsPassword || passwordRules(password).every((r) => r.met);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rulesMet || !agree) return;
    setBusy(true); setError(null);
    if (needsPassword) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setBusy(false); setError(friendlyAuthError(error.message)); return; }
      setRecovering(false);
    }
    try { await agreeGuidelines(); } catch { /* shown again on the Guidelines page */ }
    await refreshPartner();
    setBusy(false);
    navigate('/partner', { replace: true });
  }

  return (
    <AuthLayout
      title={`Welcome, ${partner.name.split(/\s+/)[0]}`}
      subtitle={<>You earn <strong>{pctLabel(partner.commission_rate)}</strong> of every plan payment {termLabel(partner.commission_months)}.</>}
    >
      <form onSubmit={submit} className="stack">
        {partner.code && <div className="copy-row"><span className="grow small muted">Your code</span><strong>{partner.code}</strong></div>}
        {needsPassword && (
          <>
            <Field label="Choose a password">
              <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <PasswordRules password={password} />
          </>
        )}
        <label className="check small">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I’ve read the <a href="/app/partner/guidelines" target="_blank" rel="noreferrer">partner guidelines</a>: no paid ads on Bakerï’s name, honest claims only, and outreach that follows anti-spam law.</span>
        </label>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy} disabled={!rulesMet || !agree} className="btn-block">Open my dashboard</Button>
      </form>
    </AuthLayout>
  );
}
