import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LOGO } from '../lib/brand';
import { Button, ErrorBanner, Spinner } from '../components/ui';
import { PLANS, TESTFLIGHT_URL, TRIAL_DAYS, clearPlanIntent, effectiveTier, hasSubscription, openBillingPortal, startCheckout, storedPlanIntent, type PlanDef, type PlanTier } from '../lib/plans';
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
  const current = effectiveTier(plan);
  // A live Stripe subscription — switching plans then happens in Stripe's
  // billing portal, so there's only ever one per vendor. Grandfathered
  // accounts have free Starter with no subscription.
  const subscribed = hasSubscription(plan);
  const grandfathered = !!plan?.grandfathered_starter;
  const trial = !plan?.trial_used_at && TRIAL_DAYS > 0;
  const lapsed = current === 'none' && !!plan?.stripe_customer_id;
  // Came from the site's "Try Pro free" button: straight to the Pro trial page.
  const wantsPro = params.get('tier') === 'pro' || session?.user?.user_metadata?.plan_intent === 'pro' || storedPlanIntent() === 'pro';
  if (wantsPro && trial && current === 'none' && !subscribed && !grandfathered && !params.has('all')) {
    return <Navigate to="/plan/trial?tier=pro" replace />;
  }

  async function pick(tier: PlanTier) {
    if (trial) { navigate(`/plan/trial?tier=${tier}`); return; }
    setBusy(tier); setError(null);
    clearPlanIntent();
    try { await startCheckout(tier, 'month'); } catch (e: any) { setError(e?.message ?? 'Something went wrong. Please try again.'); setBusy(null); }
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
        <h1>{current !== 'none' ? 'Your plan' : lapsed ? 'Pick a plan to keep going' : 'Find the plan for you'}</h1>
        <p className="muted">
          {grandfathered && !subscribed ? 'As one of our first vendors, Starter is free for you forever. Upgrade to Pro any time to drop the 5% fee.'
            : current !== 'none' ? 'Switch plans any time.'
            : trial ? `Try either plan free for ${TRIAL_DAYS} days. You can cancel at any time.`
            : 'Your shop is paused until you pick a plan. Everything you set up is still here.'}
        </p>
      </div>
      {error && <div className="plan-error"><ErrorBanner message={error} /></div>}
      <div className="pk-grid">
        {PLANS.map((p) => {
          const isCurrent = current === p.tier;
          const pro = p.tier === 'pro';
          return (
            <section key={p.tier} className={`pk ${pro ? 'pk-pro' : ''} ${isCurrent ? 'current' : ''}`}>
              {pro && <span className="pk-badge">★ Recommended</span>}
              <header className="pk-head"><h2>{p.name}</h2></header>
              <div className="pk-body">
                <PlanPrice p={p} grandfathered={grandfathered} />
                <p className="pk-sub">{p.feePct ? `Billed monthly · ${p.feePct}% Bakeri fee per sale` : 'Billed monthly · No Bakeri fee on any sale'}</p>
                {isCurrent ? (
                  <Button variant="secondary" className="pk-btn" disabled>Current plan</Button>
                ) : grandfathered && p.tier === 'starter' ? (
                  // Back to free Starter = cancel Pro in the billing portal.
                  <Button variant="secondary" className="pk-btn" loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Go back to free Starter</Button>
                ) : subscribed ? (
                  <Button variant={pro ? 'primary' : 'secondary'} className="pk-btn" loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Switch to {p.name}</Button>
                ) : (
                  <Button variant={pro ? 'primary' : 'secondary'} className="pk-btn" loading={busy === p.tier} disabled={!!busy} onClick={() => pick(p.tier)}>
                    {trial ? `Try free for ${TRIAL_DAYS} days` : `Choose ${p.name}`}
                  </Button>
                )}
                <hr />
                <p className="pk-lead">{pro ? 'Everything in Starter, plus:' : 'Everything you need to sell:'}</p>
                <ul className="pk-perks">{p.perks.filter((x) => x !== 'Everything in Starter').map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            </section>
          );
        })}
      </div>
      <p className="small muted plan-note">Prices in USD. Stripe card fees apply on both plans. Pro costs $15 more a month and saves you 5% on every sale — so it pays for itself once you sell about $300 a month.</p>
      <div className="auth-footer plan-footer">
        {subscribed && <><button type="button" className="link-btn" onClick={manage} disabled={!!busy}>Manage billing &amp; invoices</button> · </>}
        {current !== 'none' ? <Link to="/">Back to Bakeri</Link> : <button type="button" className="link-btn" onClick={signOut}>Sign out</button>}
      </div>
    </div>
  );
}

function PlanPrice({ p, grandfathered }: { p: PlanDef; grandfathered: boolean }) {
  if (grandfathered && p.tier === 'starter') return <div className="pk-price"><b>$0</b><span>/mo</span><small>Free for you, forever</small></div>;
  if (p.salePrice) {
    return (
      <div className="pk-price">
        <s>${p.price.toFixed(2)}</s> <b>${p.salePrice.toFixed(2)}</b><span>/mo</span>
        <small>For your first {p.saleMonths} months, then ${p.price.toFixed(2)}/mo</small>
      </div>
    );
  }
  return <div className="pk-price"><b>${p.price.toFixed(2)}</b><span>/mo</span></div>;
}

/**
 * "Claim a free 7-day trial" — between picking a plan and Stripe Checkout:
 * what happens today, how to cancel, and when the plan starts.
 */
export function TrialPage() {
  const { plan } = useAuth();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = PLANS.find((x) => x.tier === params.get('tier')) ?? PLANS.find((x) => x.tier === 'pro')!;
  const trial = !plan?.trial_used_at && TRIAL_DAYS > 0;
  if (hasSubscription(plan)) return <Navigate to="/plan" replace />;

  const starts = new Date(Date.now() + TRIAL_DAYS * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const then = p.salePrice ? `$${p.salePrice.toFixed(2)}/month for your first ${p.saleMonths} months, then $${p.price.toFixed(2)}` : `$${p.price.toFixed(2)}/month`;

  async function go() {
    setBusy(true); setError(null);
    clearPlanIntent();
    try { await startCheckout(p.tier, 'month'); } catch (e: any) { setError(e?.message ?? 'Something went wrong. Please try again.'); setBusy(false); }
  }

  return (
    <div className="auth-page trial-page">
      <Link to="/plan?all" className="trial-back">‹ Back to plans</Link>
      <div className="trial-brand"><img src={LOGO} alt="Bakeri" /> <span>{p.name}</span></div>
      <h1 className="trial-title">{trial ? <>Claim a free<br />{TRIAL_DAYS}-day {p.name} trial</> : <>Start {p.name}</>}</h1>
      <p className="trial-sub">{p.tier === 'pro' ? 'Everything Bakeri does, with no Bakeri fee on any sale.' : 'Your storefront, orders and kitchen tools, all in one place.'}</p>
      {error && <div className="plan-error"><ErrorBanner message={error} /></div>}
      <ol className="trial-steps">
        <li><span className="ts-dot hot">✦</span><div><b>Today</b><p>Your shop is ready to go — take orders and get paid. <Link to="/plan?all">Cancel any time</Link>.</p></div></li>
        {trial && <li><span className="ts-dot">✕</span><div><b>Any time before {starts}</b><p>Cancel from Settings → Plan &amp; billing and you won’t be charged.</p></div></li>}
        <li><span className="ts-dot">✓</span><div><b>{trial ? `In ${TRIAL_DAYS} days` : 'Each month'}</b><p>{trial ? `Your plan starts on ${starts} at ${then}, unless you cancel during the trial.` : `${then}. Cancel any time.`}</p></div></li>
      </ol>
      <div className="trial-foot">
        <p className="muted small">{trial ? 'Due today: $0.00 · Prices in USD' : 'Prices in USD'}</p>
        <Button className="trial-btn" loading={busy} onClick={go}>{trial ? 'Continue with free trial' : 'Continue to payment'}</Button>
      </div>
    </div>
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
