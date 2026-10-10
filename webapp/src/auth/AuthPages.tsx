import { LOGO } from '../lib/brand';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { appURL, supabase } from '../lib/supabase';
import { Button, ErrorBanner, Field, Input, Spinner } from '../components/ui';
import { useAuth } from './AuthProvider';

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
      {footer && <div className="auth-footer">{footer}</div>}
    </div>
  );
}

// Same rules as the iOS sign-up form (AuthView.passwordRules) and the
// Supabase project's password policy.
export function passwordRules(pw: string) {
  return [
    { label: 'At least 12 characters', met: pw.length >= 12 },
    { label: 'An uppercase letter', met: /[A-Z]/.test(pw) },
    { label: 'A lowercase letter', met: /[a-z]/.test(pw) },
    { label: 'A number', met: /[0-9]/.test(pw) },
  ];
}

function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="pw-rules">
      {passwordRules(password).map((r) => (
        <li key={r.label} className={r.met ? 'met' : ''}>{r.met ? '✓' : '•'} {r.label}</li>
      ))}
    </ul>
  );
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That email and password don’t match. Check them and try again.';
  if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox for the link we sent.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (m.includes('weak') || m.includes('password should')) return 'That password is too weak. Use at least 12 characters with upper and lowercase letters and a number.';
  return message;
}

export function LoginPage() {
  const { session } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (session) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Manage your orders, menu and customers from your computer."
      footer={<>New to Bakeri? <Link to="/signup">Create an account</Link></>}
    >
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy} className="btn-block">Log in</Button>
        <Link to="/forgot-password" className="center small">Forgot your password?</Link>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [business, setBusiness] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState(params.get('ref') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  const rulesMet = passwordRules(password).every((r) => r.met);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rulesMet) { setError('Please choose a stronger password.'); return; }
    setBusy(true); setError(null);
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    // Same user_metadata keys as iOS AuthService.signUp — the confirmation
    // email template reads first_name, and the profile/referral setup reads
    // full_name, bakery_name and referral_code after confirmation.
    const data: Record<string, string> = {};
    if (fullName) data.full_name = fullName;
    if (business.trim()) data.bakery_name = business.trim();
    if (firstName.trim()) data.first_name = firstName.trim();
    if (lastName.trim()) data.last_name = lastName.trim();
    if (referral.trim()) data.referral_code = referral.trim().toUpperCase();
    const { data: res, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data, emailRedirectTo: appURL('auth/callback') },
    });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      setError(m.includes('already') ? 'An account with this email already exists. Please log in, or reset your password.' : friendlyAuthError(error.message));
      return;
    }
    // Supabase's anti-enumeration response for an existing confirmed
    // account: no session and an empty identities array.
    if (!res.session && res.user && res.user.identities?.length === 0) {
      setError('An account with this email already exists. Please log in, or reset your password.');
      return;
    }
    if (!res.session) setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login">Back to log in</Link>}>
        <p>We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish creating your account.</p>
        <p className="muted small">Can’t find it? Check your spam or promotions folder.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your Bakeri account"
      subtitle="Your link-in-bio storefront and order manager."
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    >
      <form onSubmit={submit} className="stack">
        <div className="grid-2">
          <Field label="First name">
            <Input autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Business name">
          <Input autoComplete="organization" required value={business} onChange={(e) => setBusiness(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {password && <PasswordRules password={password} />}
        <Field label="Referral code (optional)">
          <Input value={referral} onChange={(e) => setReferral(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy} className="btn-block">Create account</Button>
        <p className="muted small center">
          By creating an account you agree to the <a href="/terms-of-service.html" target="_blank" rel="noreferrer">Terms</a> and{' '}
          <a href="/privacy-policy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
        </p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appURL('reset-password') });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
    else setSent(true);
  }

  return (
    <AuthLayout title="Reset your password" footer={<Link to="/login">Back to log in</Link>}>
      {sent ? (
        <p>If an account exists for <strong>{email}</strong>, we’ve emailed a link to reset the password. Open it on this device.</p>
      ) : (
        <form onSubmit={submit} className="stack">
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" loading={busy} className="btn-block">Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { session, setRecovering } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error_description'));
  const [waited, setWaited] = useState(false);

  // detectSessionInUrl exchanges ?code= in the background; give it a moment
  // before deciding the link didn't work.
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);

  if (session === undefined || (!session && !waited && !error)) {
    return <AuthLayout title="Reset your password"><Spinner label="Checking your link…" /></AuthLayout>;
  }

  if (!session) {
    return (
      <AuthLayout title="Link expired" footer={<Link to="/login">Back to log in</Link>}>
        <p>This reset link has expired or was opened on a different device or browser. Request a new one and open it here.</p>
        <Link to="/forgot-password" className="btn btn-primary btn-block">Send a new link</Link>
      </AuthLayout>
    );
  }

  const rulesMet = passwordRules(password).every((r) => r.met);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rulesMet) return;
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(friendlyAuthError(error.message)); return; }
    setRecovering(false);
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} className="stack">
        <Field label="New password">
          <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <PasswordRules password={password} />
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy} disabled={!rulesMet} className="btn-block">Save password</Button>
      </form>
    </AuthLayout>
  );
}

/** Landing page for the sign-up confirmation email link. */
export function AuthCallbackPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);

  const err = params.get('error_description');
  if (session) return <Navigate to="/" replace />;
  if (!waited && !err) return <AuthLayout title="Confirming…"><Spinner /></AuthLayout>;
  // The confirmation itself happens on Supabase's side before this redirect,
  // so even when the browser can't finish signing in (link opened in a
  // different browser than the sign-up — PKCE needs the original one), the
  // account is confirmed and a normal log-in works.
  return (
    <AuthLayout title={err ? 'That link didn’t work' : 'Email confirmed'} footer={<Link to="/signup">Create an account</Link>}>
      <p>{err ? `${err}. ` : 'Your email is confirmed. '}Log in to continue.</p>
      <Link to="/login" className="btn btn-primary btn-block">Log in</Link>
    </AuthLayout>
  );
}
