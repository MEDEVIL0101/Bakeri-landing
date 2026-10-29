import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LOGO } from '../lib/brand';
import { Button, ErrorBanner, Spinner } from '../components/ui';
import { PLANS, TESTFLIGHT_URL, TRIAL_DAYS, effectiveTier, hasSubscription, openBillingPortal, startCheckout, type PlanTier } from '../lib/plans';
import { useAuth } from './AuthProvider';

/**
 * Plan picker — the step after creating an account on the web, the page a
 * vendor lands on when a trial or subscription ends, and "Plan & billing"
 * afterwards. Picking a plan goes to Stripe Checkout (free trial on a
 * vendor's first subscription) and comes back to /welcome. Web only: the
 * iOS app never shows this.
 */
export function PlanPage() {
  const { plan, signOut } = useAuth();
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

  async function pick(tier: PlanTier) {
    setBusy(tier); setError(null);
    try { await startCheckout(tier, 'month'); } catch (e: any) { setError(e?.message ?? 'Something went wrong. Please try again.'); setBusy(null); }
  }

  async function manage() {
    setBusy('portal'); setError(null);
    try { await openBillingPortal(); } catch (e: any) { setError(e?.message ?? 'Something went wrong.'); setBusy(null); }
  }

  return (
    <div className="auth-page plan-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="plan-head">
        <h1>{current !== 'none' ? 'Your plan' : lapsed ? 'Pick a plan to keep going' : 'Choose your plan'}</h1>
        <p className="muted">
          {grandfathered && !subscribed ? 'As one of our first vendors, Starter is free for you forever. Upgrade to Pro any time to drop the 5% fee.'
            : current !== 'none' ? 'Switch plans any time.'
            : trial ? `Try either plan free for ${TRIAL_DAYS} days. You won’t be charged until your trial ends, and you can switch or cancel any time.`
            : 'Your shop is paused until you pick a plan. Everything you set up is still here.'}
        </p>
      </div>
      {error && <div className="plan-error"><ErrorBanner message={error} /></div>}
      <div className="plan-grid two">
        {PLANS.map((p) => {
          const isCurrent = current === p.tier;
          return (
            <section key={p.tier} className={`plan-card ${p.tier === 'pro' ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}>
              {p.tier === 'pro' && <span className="plan-flag">Best value</span>}
              <h2>{p.name}</h2>
              <p className="muted small">{p.blurb}</p>
              <div className="plan-price">
                {grandfathered && p.tier === 'starter' ? (
                  <><span className="plan-amount">$0</span><span className="muted small">free for you, forever</span></>
                ) : (
                  <><span className="plan-amount">${p.price.toFixed(2)}</span><span className="muted small">USD / month</span></>
                )}
              </div>
              <div className="plan-fee">
                {p.feePct ? <><strong>{p.feePct}%</strong> Bakeri fee per sale</> : <strong>No Bakeri fee</strong>}
                <span className="muted"> + Stripe card fees</span>
              </div>
              <ul className="plan-perks">{p.perks.map((x) => <li key={x}>{x}</li>)}</ul>
              {isCurrent ? (
                <Button variant="secondary" disabled>Current plan</Button>
              ) : grandfathered && p.tier === 'starter' ? (
                // Back to free Starter = cancel Pro in the billing portal.
                <Button variant="secondary" loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Go back to free Starter</Button>
              ) : subscribed ? (
                <Button variant={p.tier === 'pro' ? 'primary' : 'secondary'} loading={busy === 'portal'} disabled={!!busy} onClick={manage}>Switch to {p.name}</Button>
              ) : (
                <Button variant={p.tier === 'pro' ? 'primary' : 'secondary'} loading={busy === p.tier} disabled={!!busy} onClick={() => pick(p.tier)}>
                  {trial ? `Start ${TRIAL_DAYS}-day free trial` : `Choose ${p.name}`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
      <p className="small muted plan-note">Pro costs $14 more a month and saves you 5% on every sale — so it pays for itself once you sell about $280 a month.</p>
      <div className="auth-footer plan-footer">
        {subscribed && <><button type="button" className="link-btn" onClick={manage} disabled={!!busy}>Manage billing &amp; invoices</button> · </>}
        {current !== 'none' ? <Link to="/">Back to Bakeri</Link> : <button type="button" className="link-btn" onClick={signOut}>Sign out</button>}
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
