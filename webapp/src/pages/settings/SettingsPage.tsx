import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { passwordRules } from '../../auth/AuthPages';
import { Button, ErrorBanner, Field, Input, Modal, PageHeader, Select, Textarea, useLoad, useToast } from '../../components/ui';
import {
  FEEDBACK_CATEGORIES, formatCents, referralDashboard, saveUserName, scheduleAccountDeletion, sendFeedback, updatePassword,
} from '../../lib/account';
import { HelpContent } from './HelpContent';
import { useUnitSystem } from '../../lib/prefs';

export function SettingsPage() {
  const userId = useUserId();
  const { profile, session, refreshProfile } = useAuth();
  const toast = useToast();
  const referral = useLoad(() => referralDashboard(), []);
  const [name, setName] = useState(profile?.user_name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [units, setUnits] = useUnitSystem();
  const [modal, setModal] = useState<null | 'password' | 'help' | 'feedback' | 'delete'>(null);

  const r = referral.data;
  const referralSub = !r
    ? 'Earn about 1% of every sale from bakers you invite'
    : !r.eligible ? 'Connect Direct Deposit to unlock'
      : r.referred_count === 0 ? 'Share your code and earn about 1% of their sales'
        : `${r.referred_count === 1 ? '1 baker' : `${r.referred_count} bakers`} referred · ${formatCents(r.available_cents + r.pending_cents + r.paid_cents, r.currency)} earned`;

  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" subtitle="Your account, payouts, and support." />

      <Link to="/refer" className="promo-card">
        <span className="promo-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
        </span>
        <span className="grow">
          <span className="row-title">Refer a Baker</span>
          <span className="row-sub">{referralSub}</span>
        </span>
        <span className="chev" aria-hidden>›</span>
      </Link>

      <SettingsGroup heading="Account">
        <div className="settings-row">
          <form className="name-form" onSubmit={async (e) => {
            e.preventDefault();
            setSavingName(true);
            try { await saveUserName(userId, name); await refreshProfile(); toast('Name saved'); } catch (err: any) { toast(err.message, 'error'); }
            setSavingName(false);
          }}>
            <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
            {name.trim() !== (profile?.user_name ?? '') && <Button type="submit" loading={savingName}>Save</Button>}
          </form>
        </div>
        <InfoRow title="Email" value={session?.user.email ?? ''} />
        <NavRow title="Change password" onClick={() => setModal('password')} />
      </SettingsGroup>

      <SettingsGroup heading="Business">
        <NavRow title="Direct Deposit" sub={profile?.stripe_connect_onboarding_complete ? 'Stripe connected' : 'Connect to get paid'} to="/payouts" />
        <NavRow title="Shop settings" sub="Your link, pickup address, shipping" to="/shop-settings" />
        <NavRow title="Order forms" sub="Custom order request forms" to="/forms" />
      </SettingsGroup>

      <SettingsGroup heading="Recipes" footer="Saved in this browser — used by the calculator, recipe weights, and ingredient totals.">
        <div className="settings-row">
          <span className="grow settings-title">Units</span>
          <div className="seg sm">
            <button className={units === 'us' ? 'active' : ''} onClick={() => setUnits('us')}>US</button>
            <button className={units === 'metric' ? 'active' : ''} onClick={() => setUnits('metric')}>Metric</button>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup heading="Help & Support">
        <NavRow title="Help Center" sub="How payments, fees, and payouts work" onClick={() => setModal('help')} />
        <NavRow title="Send feedback" onClick={() => setModal('feedback')} />
      </SettingsGroup>

      <SettingsGroup heading="About Bakeri">
        <NavRow title="Privacy Policy" href="https://www.bakeriapp.com/privacy-policy.html" />
        <NavRow title="Terms of Service" href="https://www.bakeriapp.com/terms-of-service.html" />
      </SettingsGroup>

      <button className="danger-card" onClick={() => setModal('delete')}>Delete account</button>

      {modal === 'password' && <ChangePasswordModal onClose={() => setModal(null)} />}
      {modal === 'help' && (
        <Modal title="Help Center" wide onClose={() => setModal(null)}
          footer={<Button variant="secondary" onClick={() => setModal('feedback')}>Still stuck? Send us a message</Button>}>
          <HelpContent />
        </Modal>
      )}
      {modal === 'feedback' && <FeedbackModal userId={userId} onClose={() => setModal(null)} />}
      {modal === 'delete' && <DeleteAccountModal userId={userId} onClose={() => setModal(null)} />}
    </div>
  );
}

export function SettingsGroup({ heading, children, footer }: { heading: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h2 className="settings-heading">{heading}</h2>
      <div className="settings-card">{children}</div>
      {footer && <p className="settings-footer">{footer}</p>}
    </section>
  );
}

function InfoRow({ title, value }: { title: string; value: string }) {
  return (
    <div className="settings-row">
      <span className="grow">{title}</span>
      <span className="muted ellipsis">{value}</span>
    </div>
  );
}

function NavRow({ title, sub, to, href, onClick }: { title: string; sub?: string; to?: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="grow">
        <span className="settings-title">{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      <span className="chev" aria-hidden>{href ? '↗' : '›'}</span>
    </>
  );
  if (to) return <Link to={to} className="settings-row settings-link">{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="settings-row settings-link">{inner}</a>;
  return <button type="button" onClick={onClick} className="settings-row settings-link">{inner}</button>;
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rules = passwordRules(pw);
  const ok = rules.every((r) => r.met) && pw === confirm;
  return (
    <Modal title="Change password" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await updatePassword(pw); toast('Password updated'); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Save new password</Button>
      </>}>
      <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <ul className="pw-rules">
        {rules.map((r) => <li key={r.label} className={r.met ? 'met' : ''}>{r.met ? '✓' : '•'} {r.label}</li>)}
      </ul>
      <Field label="Confirm new password" error={confirm && confirm !== pw ? 'Passwords don’t match' : null}>
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}

function FeedbackModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState<string>(FEEDBACK_CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Send feedback" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={message.trim().length < 3} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await sendFeedback(userId, category, message); toast('Thanks — your feedback has been received'); onClose(); }
          catch { setErr('Couldn’t send feedback. Please try again.'); setBusy(false); }
        }}>Send</Button>
      </>}>
      <Field label="What’s on your mind?">
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {FEEDBACK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Message"><Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us more…" /></Field>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}

function DeleteAccountModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deadline = new Date(Date.now() + 30 * 86400_000).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <Modal title="Delete your account" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Keep my account</Button>
        <Button variant="danger" loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await scheduleAccountDeletion(userId); navigate('/login'); }
          catch { setErr('Could not schedule deletion. Please check your connection and try again.'); setBusy(false); }
        }}>Delete my account</Button>
      </>}>
      <p className="muted">Your account will be permanently deleted after a 30-day cooling-off period.</p>
      <p><strong>What will be deleted:</strong> your storefront, listings, orders, customers, recipes, schedule, and all your settings.</p>
      <div className="banner banner-info">Just sign back in before {deadline} to cancel and keep everything.</div>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}
