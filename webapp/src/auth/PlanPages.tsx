import { keepReferralCode, rememberedReferralCode } from '../lib/referralMemory';
import { useEffect, useState, type FormEvent } from 'react';
import { trackSite } from '../lib/siteTrack';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LOGO } from '../lib/brand';
import { Button, ErrorBanner, Field, Input, Spinner } from '../components/ui';
import { appURL, supabase } from '../lib/supabase';
import { PasswordRules, friendlyAuthError, passwordRules } from './AuthPages';
import { PLANS, TESTFLIGHT_URL, TRIAL_DAYS, YEARLY_FREE_MONTHS, clearPlanIntent, effectiveTier, rememberCycleIntent, rememberPlanIntent, storedCycleIntent, storedPlanIntent, hasSubscription, openBillingPortal, promoLine, startCheckout, usePlanPromo, type BillingInterval, type PlanDef, type PlanTier } from '../lib/plans';
import { useAuth } from './AuthProvider';

/**
 * Plan picker ("Find the plan for you") — the step after creating an
 * account on the web, the page a vendor lands on when a trial or
 * subscription ends, and "Plan & billing" afterwards. Picking a plan with a
 * trial goes to the trial page (/plan/trial), then Stripe Checkout, and
 * back to /welcome. Web only: the iOS app never shows this.
 */
export function PlanPage() {
  const { plan, signOut, session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<PlanTier | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingInterval>('month');
  const current = effectiveTier(plan);
  useEffect(() => { trackSite('plan_view'); }, []);
  // A live Stripe subscription — switching plans then happens in Stripe's
  // billing portal, so there's only ever one per vendor. Grandfathered
  // accounts have free Starter with no subscription.
  const subscribed = hasSubscription(plan);
  // Lifetime Pro (set by hand): nothing to buy or switch.
  const lifetime = !!plan?.lifetime_pro;
  const grandfathered = !lifetime && !!plan?.grandfathered_starter;
  const trial = !plan?.trial_used_at && TRIAL_DAYS > 0;
  const lapsed = current === 'none' && !!plan?.stripe_customer_id;
  // Signed up with a referral code and hasn't had a plan yet → 10% off at checkout.
  const referred = !subscribed && !lifetime && !plan?.trial_used_at
    ? String(session?.user.user_metadata?.referral_code ?? '').trim().toUpperCase() || null
    : null;
  const promo = usePlanPromo(referred);
  // New vendors see Pro first (the site's sign-up funnel); Skip → /plan?all shows every plan.
  // Starting from "Try Starter free" opens every plan straight away, so Pro sits beside it.
  // The account's own sign-up choice wins over this browser's, which can be left over from another sign-up.
  // Back from confirming their email: straight to the plan and billing cycle
  // they picked before creating the account (pricing comes first now).
  const intent = (session?.user.user_metadata?.plan_intent ?? storedPlanIntent()) as string | null;
  const cycleIntent = (session?.user.user_metadata?.plan_cycle ?? storedCycleIntent()) as string | null;
  if (trial && current === 'none' && !subscribed && !grandfathered && !params.has('all')) {
    const tier = intent === 'starter' ? 'starter' : 'pro';
    return <Navigate to={`/plan/trial?tier=${tier}${cycleIntent === 'month' || cycleIntent === 'year' ? `&cycle=${cycleIntent}` : ''}`} replace />;
  }

  function pick(tier: PlanTier) {
    clearPlanIntent();
    navigate(`/plan/trial?tier=${tier}&cycle=${cycle}&picked`);
  }

  async function manage() {
    setBusy('portal'); setError(null);
    try { await openBillingPortal(); } catch (e: any) { setError(e?.message ?? 'Something went wrong.'); setBusy(null); }
  }

  return (
    <div className="auth-page plan-page">
      {current !== 'none' && <Link to="/" className="plan-back" aria-label="Back to Bakeri">‹</Link>}
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="plan-head">
        <h1>{current !== 'none' ? 'Your plan' : lapsed ? 'Pick a plan to keep going' : trial ? `Sign up and get ${TRIAL_DAYS} days free` : 'Find the plan for you'}</h1>
        <p className="muted">
          {lifetime ? 'Pro is free for you, for life. Nothing to pay and no Bakeri fee on your sales.'
            : grandfathered && !subscribed ? 'As one of our first vendors, Starter is free for you forever. Upgrade to Pro any time to drop the 5% fee.'
            : current !== 'none' ? 'Switch plans any time.'
            : trial ? `Try either plan free for ${TRIAL_DAYS} days. You can cancel at any time.`
            : 'Your shop is paused until you pick a plan. Everything you set up is still here.'}
        </p>
      </div>
      {referred && (promo
        ? <p className="ref-note plan-ref">Promo code <b>{promo.code}</b>: <b>{promoLine(promo)}</b>.</p>
        : <p className="ref-note plan-ref">Your referral code <b>{referred}</b> is applied: <b>10% off your first 3 months</b>, taken off at checkout.</p>)}
      {error && <div className="plan-error"><ErrorBanner message={error} /></div>}
      {!lifetime && !grandfathered && !subscribed && (
        <div className="pk-cycle" role="tablist" aria-label="Billing cycle">
          <button type="button" role="tab" aria-selected={cycle === 'month'} className={cycle === 'month' ? 'on' : ''} onClick={() => setCycle('month')}>Monthly</button>
          <button type="button" role="tab" aria-selected={cycle === 'year'} className={cycle === 'year' ? 'on' : ''} onClick={() => setCycle('year')}>Annually <span className="pk-save">{YEARLY_FREE_MONTHS} months free!</span></button>
        </div>
      )}
      <div className="pk-grid">
        {PLANS.map((p) => {
          const isCurrent = current === p.tier;
          const pro = p.tier === 'pro';
          return (
            <section key={p.tier} className={`pk ${pro ? 'pk-pro' : ''} ${isCurrent ? 'current' : ''}`}>
              {pro && <span className="pk-badge">★ Recommended</span>}
              <header className="pk-head"><h2>{p.name}</h2><p>{p.tagline}</p></header>
              <div className="pk-body">
                <PlanPrice p={p} grandfathered={grandfathered} lifetime={lifetime} cycle={cycle} />
                <p className="pk-sub">{p.feePct ? `${p.feePct}% Bakeri fee per sale` : 'No Bakeri fee on any sale'}</p>
                {isCurrent ? (
                  <Button variant="secondary" className="pk-btn" disabled>Current plan</Button>
                ) : lifetime ? (
                  <Button variant="secondary" className="pk-btn" disabled>Included in Pro</Button>
                ) : grandfathered && p.tier === 'starter' ? (
                  // Back to free Starter = cancel Pro in the billing portal.
                  <Button variant="secondary" className="pk-btn" loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Go back to free Starter</Button>
                ) : subscribed ? (
                  <Button variant={pro ? 'primary' : 'secondary'} className="pk-btn" loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Switch to {p.name}</Button>
                ) : (
                  <Button variant={pro ? 'primary' : 'secondary'} className="pk-btn" loading={busy === p.tier} disabled={!!busy} onClick={() => pick(p.tier)}>
                    {trial ? `Try free for ${promo?.tier === p.tier ? promo.trial_days : TRIAL_DAYS} days` : `Choose ${p.name}`}
                  </Button>
                )}
                <hr />
                <p className="pk-lead">{pro ? 'All features in Starter, and' : 'Standout features:'}</p>
                <ul className="pk-perks">{p.perks.filter((x) => x !== 'Everything in Starter').map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            </section>
          );
        })}
      </div>
      <p className="small muted plan-note">Prices in USD. Stripe card fees apply on both plans. Pro costs $20 more a month and saves you 5% on every sale — so it pays for itself once you sell about $400 a month.</p>
      <div className="auth-footer plan-footer">
        {subscribed && <><button type="button" className="link-btn" onClick={manage} disabled={!!busy}>Manage billing &amp; invoices</button> · </>}
        {!session ? <>Already have an account? <Link to="/login">Log in</Link></>
          : current !== 'none' ? <Link to="/">Back to Bakeri</Link> : <button type="button" className="link-btn" onClick={signOut}>Sign out</button>}
      </div>
    </div>
  );
}

function PlanPrice({ p, grandfathered, lifetime, cycle }: { p: PlanDef; grandfathered: boolean; lifetime: boolean; cycle: BillingInterval }) {
  if (lifetime && p.tier === 'pro') return <div className="pk-price"><b>$0</b><span>/month</span><small>Free for you, for life</small></div>;
  const m = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;
  if (grandfathered && p.tier === 'starter') return <div className="pk-price"><b>$0</b><span>/month</span><small>Free for you, forever</small></div>;
  if (cycle === 'year') {
    return (
      <div className="pk-price">
        <s>{m(p.price)}</s><b>{m(Math.round((p.yearPrice / 12) * 100) / 100)}</b><span>/mo</span>
        <small>{m(p.yearPrice)} billed annually</small>
      </div>
    );
  }
  if (p.salePrice) {
    return (
      <div className="pk-price">
        <s>{m(p.price)}</s><b>{m(p.salePrice)}</b><span>/month</span>
        <small>For your first {p.saleMonths} months, then {m(p.price)}/month</small>
      </div>
    );
  }
  return <div className="pk-price"><b>{m(p.price)}</b><span>/month</span><small>Billed monthly</small></div>;
}

/**
 * "Claim a free 14-day trial" — between picking a plan and Stripe Checkout:
 * the billing cycle (yearly = 2 months free), what happens today and when the plan
 * starts. New vendors land here on Pro first; Skip opens every plan.
 */
export function TrialPage() {
  const { plan, session } = useAuth();
  const [params] = useSearchParams();
  const [interval, setCycle] = useState<BillingInterval>(params.get('cycle') === 'year' ? 'year' : 'month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = PLANS.find((x) => x.tier === params.get('tier')) ?? PLANS.find((x) => x.tier === 'pro')!;
  const trial = !plan?.trial_used_at && TRIAL_DAYS > 0;
  const fromPicker = params.has('picked');
  // A visitor's referral code: from the link, or the one the homepage kept.
  const visitorRef = (() => {
    let r = params.get('ref') ?? '';
    if (r) keepReferralCode(r); else r = rememberedReferralCode();
    return r.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  })();
  // Signed up with a referral code → 10% off the first 3 months at checkout.
  const referred = !plan?.trial_used_at && !plan?.lifetime_pro
    ? String(session?.user.user_metadata?.referral_code ?? (session ? '' : visitorRef)).trim().toUpperCase() || null
    : null;
  // A promo code for this plan lengthens the trial (create-plan-checkout applies it).
  const promo = usePlanPromo(referred);
  const trialDays = trial && promo?.tier === p.tier ? promo.trial_days : TRIAL_DAYS;
  // Visitors create their account here, after seeing the plan.
  const [showAccount, setShowAccount] = useState(false);
  useEffect(() => { if (!session) trackSite('plan_view', `${p.tier}-visitor`); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (hasSubscription(plan)) return <Navigate to="/plan" replace />;

  const starts = new Date(Date.now() + trialDays * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;
  const monthly = p.salePrice ? `${money(p.salePrice)}/month for your first ${p.saleMonths} months, then ${money(p.price)}/month` : `${money(p.price)}/month`;
  const then = interval === 'year' ? `${money(p.yearPrice)}/year` : monthly;

  async function go() {
    if (!session) { setShowAccount(true); trackSite('signup_view', p.tier); return; }
    setBusy(true); setError(null);
    clearPlanIntent();
    try { await startCheckout(p.tier, interval); } catch (e: any) { setError(e?.message ?? 'Something went wrong. Please try again.'); setBusy(false); }
  }

  return (
    <div className="auth-page trial-page">
      {fromPicker ? <Link to="/plan?all" className="trial-back">‹ Back to plans</Link> : <Link to="/plan?all" className="trial-skip">See all plans</Link>}
      <div className="trial-brand"><img src={LOGO} alt="Bakeri" /> <span>{p.name}</span></div>
      <h1 className="trial-title">{trial ? <>Claim a free<br />{trialDays}-day {p.name} trial</> : <>Start {p.name}</>}</h1>
      <p className="trial-sub">{p.tier === 'pro' ? 'Everything Bakeri does, with no Bakeri fee on any sale.' : 'Your storefront, orders and kitchen tools, all in one place.'}</p>
      {referred && (promo
        ? <p className="ref-note plan-ref">Promo code <b>{promo.code}</b>: <b>{promoLine(promo)}</b>{promo.tier !== p.tier ? ' (pick that plan to use it)' : ''}.</p>
        : <p className="ref-note plan-ref">Referral code <b>{referred}</b>: <b>10% off your first 3 months</b>{interval === 'year' ? ' (10% off your first year)' : ''}, taken off at checkout.</p>)}
      {error && <div className="plan-error"><ErrorBanner message={error} /></div>}
      <div className="cycle" role="radiogroup" aria-label="Billing cycle">
        <button type="button" role="radio" aria-checked={interval === 'month'} className={`cycle-opt ${interval === 'month' ? 'on' : ''}`} onClick={() => setCycle('month')}>
          <b>{money(p.salePrice ?? p.price)}<small>/mo</small></b>
          <span>Monthly</span>
          <small>{p.salePrice ? `Then ${money(p.price)}/month after ${p.saleMonths} months` : `${money(p.price)}/month${trial ? ' after trial' : ''}`}</small>
        </button>
        <button type="button" role="radio" aria-checked={interval === 'year'} className={`cycle-opt ${interval === 'year' ? 'on' : ''}`} onClick={() => setCycle('year')}>
          <span className="cycle-save">{YEARLY_FREE_MONTHS} months free</span>
          <b>{money(Math.round((p.yearPrice / 12) * 100) / 100)}<small>/mo</small></b>
          <span>Yearly</span>
          <small>{money(p.yearPrice)}/year{trial ? ' after trial' : ''}</small>
        </button>
      </div>
      <ol className="trial-steps">
        <li><span className="ts-dot hot">✦</span><div><b>Today</b><p>Your shop is ready to go — take orders and get paid. Cancel any time.</p></div></li>
        {trial && <li><span className="ts-dot">✕</span><div><b>Any time before {starts}</b><p>Cancel from Settings → Plan &amp; billing and you won’t be charged.</p></div></li>}
        <li><span className="ts-dot">✓</span><div><b>{trial ? `In ${trialDays} days` : 'Then'}</b><p>{trial ? `Your plan starts on ${starts} at ${then}, unless you cancel during the trial.` : `${then}. Cancel any time.`}</p></div></li>
      </ol>
      <div className="trial-foot">
        <p className="muted small">{trial ? 'Due today: $0.00' : `Due today: ${interval === 'year' ? money(p.yearPrice) : money(p.salePrice ?? p.price)}`} · Prices in USD · Stripe card fees apply</p>
        {!showAccount && <Button className="trial-btn" loading={busy} onClick={go}>{trial ? 'Continue with free trial' : 'Continue to payment'}</Button>}
      </div>
      {showAccount && !session && <TrialAccountForm tier={p.tier} interval={interval} planName={p.name} referral={visitorRef} />}
      {!session && <p className="auth-footer" style={{ textAlign: 'center' }}>Already have an account? <Link to="/login">Log in</Link></p>}
    </div>
  );
}

/**
 * The account, made last: email + password on the trial page, with the
 * plan, billing cycle and any referral code kept in user_metadata so the
 * confirmation link brings them straight back to this trial (PlanPage).
 */
function TrialAccountForm({ tier, interval, planName, referral }: { tier: PlanTier; interval: BillingInterval; planName: string; referral: string }) {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const rulesMet = passwordRules(password).every((r) => r.met);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rulesMet) { setError('Please choose a stronger password.'); return; }
    setBusy(true); setError(null);
    // signup_source: the before-user-created hook only allows web sign-ups.
    const data: Record<string, string> = { signup_source: 'web', plan_intent: tier, plan_cycle: interval };
    if (referral) data.referral_code = referral;
    rememberPlanIntent(tier);
    rememberCycleIntent(interval);
    const { data: res, error } = await supabase.auth.signUp({
      email: email.trim(), password, options: { data, emailRedirectTo: appURL('auth/callback') },
    });
    setBusy(false);
    const exists = 'An account with this email already exists. Log in to continue, or reset your password.';
    if (error) { setError(error.message.toLowerCase().includes('already') ? exists : friendlyAuthError(error.message)); return; }
    if (!res.session && res.user && res.user.identities?.length === 0) { setError(exists); return; }
    trackSite('signup_done', tier);
    if (!res.session) setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <div className="trial-account">
        <h2>Check your email</h2>
        <p>We sent a link to <b>{sentTo}</b>. Open it and you’ll come straight back here to start your {planName} trial.</p>
        <p className="muted small">Can’t find it? Check your spam or promotions folder.</p>
      </div>
    );
  }

  return (
    <form className="trial-account stack" onSubmit={submit}>
      <h2>Create your Bakerï account</h2>
      <Field label="Email"><Input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password"><Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {password && <PasswordRules password={password} />}
      {error && <ErrorBanner message={error} />}
      <Button type="submit" loading={busy} className="btn-block">Create account &amp; continue</Button>
      <p className="muted small center">
        By creating an account you agree to the <a href="/terms-of-service.html" target="_blank" rel="noreferrer">Terms</a> and{' '}
        <a href="/privacy-policy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
    </form>
  );
}

/**
 * Back from Stripe Checkout: confirms the plan (or trial) and
 * offers the iPhone app. Stripe's webhook can land a moment after the
 * redirect, so a checkout return polls the plan briefly.
 */
export function WelcomePage() {
  const { plan, refreshPlan, profile } = useAuth();
  const [params] = useSearchParams();
  const fromCheckout = params.has('checkout');
  const [waiting, setWaiting] = useState(fromCheckout && effectiveTier(plan) === 'none');

  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < 10 && alive; i++) {
        const p = await refreshPlan();
        if (effectiveTier(p) !== 'none') break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (alive) setWaiting(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tier = effectiveTier(plan);
  const name = PLANS.find((p) => p.tier === tier)?.name ?? '';
  const trialEnds = plan?.status === 'trialing' && plan.trial_end
    ? new Date(plan.trial_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : null;
  const setUp = !!profile?.business_name?.trim();

  return (
    <div className="auth-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="auth-card">
        {waiting ? (
          <Spinner label="Confirming your plan…" />
        ) : (
          <>
            <h1>{tier === 'none' ? 'Almost there' : trialEnds ? `Your ${name} trial has started` : `You’re on ${name}`}</h1>
            {tier === 'none' ? (
              <p className="muted">Your payment is still being confirmed. It can take a minute — refresh this page, or carry on and it’ll catch up.</p>
            ) : (
              <p className="muted">
                {trialEnds ? `It’s free until ${trialEnds} — we’ll email you before your first charge. ` : ''}
                {setUp ? 'You’re all set.' : 'Next, set up your shop — on the web here, or in the iPhone app.'}
              </p>
            )}
            <div className="welcome-app">
              <strong>Get the iPhone app</strong>
              <p className="small muted">Bakeri for iPhone is in beta on TestFlight. Install TestFlight, open this link on your iPhone, and sign in with the account you just made.</p>
              <a className="btn btn-primary" href={TESTFLIGHT_URL} target="_blank" rel="noopener noreferrer"><span>Get it on TestFlight</span></a>
            </div>
            <p className="small muted">On Android or a computer? Bakeri works right here in your browser — add it to your home screen for one-tap access.</p>
            <Link to="/" className="btn btn-secondary"><span>{setUp ? 'Go to Bakeri' : 'Set up my shop on the web'}</span></Link>
          </>
        )}
      </div>
    </div>
  );
}
