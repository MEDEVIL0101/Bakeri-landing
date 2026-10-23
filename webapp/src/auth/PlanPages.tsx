import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LOGO } from '../lib/brand';
import { Button, ErrorBanner, Spinner } from '../components/ui';
import { PLANS, TESTFLIGHT_URL, chooseFreePlan, effectiveTier, openBillingPortal, startCheckout, type BillingInterval, type PlanTier } from '../lib/plans';
import { useAuth } from './AuthProvider';

/**
 * Plan picker — the step after creating an account on the web, and the
 * "Plan & billing" page afterwards. Free is saved straight away; a paid plan
 * goes to Stripe Checkout and comes back to /welcome. Web only: the iOS app
 * never shows this.
 */
export function PlanPage() {
  const { plan, refreshPlan, signOut } = useAuth();
  const navigate = useNavigate();
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<PlanTier | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = plan?.chosen_at ? effectiveTier(plan) : null;
  const subscribed = current !== null && current !== 'free';

  async function pick(tier: PlanTier) {
    setBusy(tier); setError(null);
    try {
      if (tier === 'free') {
        await chooseFreePlan();
        await refreshPlan();
        navigate('/welcome');
      } else {
        await startCheckout(tier, interval);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  async function manage() {
    setBusy('portal'); setError(null);
    try { await openBillingPortal(); } catch (e: any) { setError(e?.message ?? 'Something went wrong.'); setBusy(null); }
  }

  return (
    <div className="auth-page plan-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="plan-head">
        <h1>{current ? 'Your plan' : 'Choose your plan'}</h1>
        <p className="muted">{current ? 'Switch plans any time.' : 'Start free and upgrade whenever you like. You can change plans any time.'}</p>
        <div className="seg sm plan-interval" role="tablist">
          <button role="tab" aria-selected={interval === 'month'} className={interval === 'month' ? 'active' : ''} onClick={() => setBillingInterval('month')}>Monthly</button>
          <button role="tab" aria-selected={interval === 'year'} className={interval === 'year' ? 'active' : ''} onClick={() => setBillingInterval('year')}>Yearly · 2 months free</button>
        </div>
      </div>
      {error && <div className="plan-error"><ErrorBanner message={error} /></div>}
      <div className="plan-grid">
        {PLANS.map((p) => {
          const isCurrent = current === p.tier;
          const price = p.price[interval];
          return (
            <section key={p.tier} className={`plan-card ${p.tier === 'pro' ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}>
              {p.tier === 'pro' && <span className="plan-flag">Most popular</span>}
              <h2>{p.name}</h2>
              <p className="muted small">{p.blurb}</p>
              <div className="plan-price">
                <span className="plan-amount">${price}</span>
                <span className="muted small">{price ? (interval === 'month' ? 'CAD / month' : 'CAD / year') : 'forever'}</span>
              </div>
              <div className="plan-fee"><strong>{p.feePct}%</strong> Bakeri fee per sale<span className="muted"> + Stripe card fees</span></div>
              <ul className="plan-perks">{p.perks.map((x) => <li key={x}>{x}</li>)}</ul>
              {isCurrent ? (
                <Button variant="secondary" disabled>Current plan</Button>
              ) : subscribed ? (
                // One subscription per vendor: switching between paid plans
                // (or back to Free) happens in Stripe's billing portal.
                <Button variant={p.tier === 'pro' ? 'primary' : 'secondary'} loading={busy === 'portal'} disabled={!!busy} onClick={manage}>
                  {p.tier === 'free' ? 'Cancel paid plan' : `Switch to ${p.name}`}
                </Button>
              ) : (
                <Button variant={p.tier === 'pro' ? 'primary' : 'secondary'} loading={busy === p.tier} disabled={!!busy} onClick={() => pick(p.tier)}>
                  {p.tier === 'free' ? 'Start free' : `Get ${p.name}`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
      <div className="auth-footer plan-footer">
        {subscribed && <><button type="button" className="link-btn" onClick={manage} disabled={!!busy}>Manage billing &amp; invoices</button> · </>}
        {current ? <Link to="/">Back to Bakeri</Link> : <button type="button" className="link-btn" onClick={signOut}>Sign out</button>}
      </div>
    </div>
  );
}

/**
 * After picking a plan (Free, or back from Stripe Checkout): confirms it and
 * offers the iPhone app. Stripe's webhook can land a moment after the
 * redirect, so a checkout return polls the plan briefly.
 */
export function WelcomePage() {
  const { plan, refreshPlan, profile } = useAuth();
  const [params] = useSearchParams();
  const fromCheckout = params.has('checkout');
  const [waiting, setWaiting] = useState(fromCheckout && effectiveTier(plan) === 'free');

  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < 10 && alive; i++) {
        const p = await refreshPlan();
        if (effectiveTier(p) !== 'free') break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (alive) setWaiting(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tier = effectiveTier(plan);
  const name = PLANS.find((p) => p.tier === tier)?.name ?? 'Free';
  const setUp = !!profile?.business_name?.trim();

  return (
    <div className="auth-page">
      <a href="/" className="auth-logo"><img src={LOGO} alt="Bakeri" /></a>
      <div className="auth-card">
        {waiting ? (
          <Spinner label="Confirming your plan…" />
        ) : (
          <>
            <h1>{fromCheckout && tier === 'free' ? 'Almost there' : `You’re on ${name}`}</h1>
            {fromCheckout && tier === 'free' ? (
              <p className="muted">Your payment is still being confirmed. It can take a minute — refresh this page, or carry on and it’ll catch up.</p>
            ) : (
              <p className="muted">{setUp ? 'Your plan is all set.' : 'Next, set up your shop — on the web here, or in the iPhone app.'}</p>
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
