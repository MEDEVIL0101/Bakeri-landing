import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorBanner, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import { formatCents, getOrCreateReferralCode, referralDashboard, referralLink } from '../../lib/account';
import type { ReferralDashboard } from '../../lib/account';
import { formatDate } from '../../lib/format';
import { PLANS, TRIAL_DAYS } from '../../lib/plans';

/** Mirrors iOS ReferABakerView. Rules: 20261029000001_bakeri_referral_program.sql. */
const COMMISSION_PCT = 20;
const REFERRAL_HELP_URL = 'https://bakeriapp.com/referral-program.html';

const PLAN_STATUS: Record<ReferralDashboard['referred_bakers'][number]['plan_status'], { label: string; tone: 'green' | 'gold' | 'neutral' }> = {
  paying: { label: 'Paying', tone: 'green' },
  trialing: { label: 'On free trial', tone: 'gold' },
  inactive: { label: 'Not subscribed', tone: 'neutral' },
};

export function ReferPage() {
  const toast = useToast();
  // Every vendor with a plan just has a code — made on first visit (from
  // the shop name), not behind a "Get my referral link" button.
  const dash = useLoad(async () => {
    const d = await referralDashboard();
    if (d.code) return d;
    try { await getOrCreateReferralCode(); } catch { return d; }
    return referralDashboard();
  }, []);
  const [claiming, setClaiming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = dash.data;

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn’t copy — select and copy it instead', 'error'); }
  }

  return (
    <div className="page page-narrow">
      <PageHeader back={<Link to="/settings" className="back-link">Settings</Link>} title="Referral Program" />
      <Card className="hero-card">
        <h2 className="hero-title">Earn {COMMISSION_PCT}% recurring commission on every vendor you refer — for as long as they stay subscribed.</h2>
        <p className="muted">Share your link or code. The vendors you refer get <b>10% off their first 3 months</b>, and you earn {COMMISSION_PCT}% of every Bakeri plan payment they make, paid to your Stripe account on the 1st of each month.</p>
        <p className="small muted">Want customers to see it too? Turn on the Bakerï Referral card in your <Link to="/storefront">storefront builder</Link>.</p>
      </Card>

      <Card title="Share Bakeri organically">
        <p className="small">The program is all about word of mouth — link sharing, shout‑outs and genuine recommendations. Paid ads aren’t part of it, and if we spot them, referral commission on your account can be turned off.</p>
      </Card>

      {dash.loading && !d ? <Spinner /> : dash.error ? <ErrorBanner message="Couldn’t load your referrals right now. Try again shortly." onRetry={dash.reload} /> : d && !d.eligible ? (
        <Card>
          <p><strong>You need an active Bakeri plan to join the referral program.</strong></p>
          <p className="muted small">Pick a plan and come back here for your link.</p>
          <div><Link to="/plan" className="btn btn-primary">Choose a plan</Link></div>
        </Card>
      ) : d && (
        <>
          {d.commission_disabled && (
            <ErrorBanner message="Referral commission is turned off on your account. Contact support if you think this is a mistake." />
          )}

          {!d.commission_disabled && (
            <Card title="Your referral link">
              {d.code ? (
                <>
                  <div className="code-display">{d.code}</div>
                  <div className="copy-row"><span className="ellipsis grow">{referralLink(d.code)}</span></div>
                  <div className="btn-row">
                    <Button onClick={() => copy(referralLink(d.code!), 'Link')}>Copy link</Button>
                    <Button variant="secondary" onClick={() => copy(d.code!, 'Code')}>Copy code</Button>
                    {'share' in navigator && (
                      <Button variant="ghost" onClick={() => navigator.share({ text: `Join me on Bakerï — use my referral code ${d.code} for 10% off your first 3 months.`, url: referralLink(d.code!) }).catch(() => {})}>Share…</Button>
                    )}
                  </div>
                  <p className="small muted">
                    Anyone who signs up with your link or code is tracked as your referral and gets 10% off their first 3 months.
                    Show it on your storefront by turning on the Bakerï Referral card in <Link to="/storefront">Storefront</Link>.
                  </p>
                </>
              ) : (
                <div><Button loading={claiming} onClick={async () => {
                  setClaiming(true); setErr(null);
                  try { await getOrCreateReferralCode(); dash.reload(); }
                  catch { setErr('Couldn’t create your link — make sure your plan is active, then try again.'); }
                  setClaiming(false);
                }}>Try again</Button></div>
              )}
              {err && <ErrorBanner message={err} />}
            </Card>
          )}

          {!d.payouts_ready && (
            <Card>
              <p><strong>Connect Stripe to get paid.</strong></p>
              <p className="muted small">Your commission is tracked either way, and pays out once your Stripe account is connected.</p>
              <div><Link to="/payouts" className="btn btn-primary">Set up Direct Deposit</Link></div>
            </Card>
          )}

          <div className="stats">
            <div className="stat stat-hero"><span className="stat-label">Ready to pay out</span><span className="stat-value">{formatCents(d.available_cents, d.currency)}</span></div>
            <div className="stat"><span className="stat-label">Pending</span><span className="stat-value">{formatCents(d.pending_cents, d.currency)}</span></div>
            <div className="stat"><span className="stat-label">Paid to date</span><span className="stat-value">{formatCents(d.paid_cents, d.currency)}</span></div>
          </div>
          <p className="small muted">
            Commission starts once a referral’s {TRIAL_DAYS}-day free trial ends and their plan is paid, and is paid out on the 1st of each month.{d.next_payout_date ? ` Next payout: ${formatDate(`${d.next_payout_date.slice(0, 10)}T12:00`)}.` : ''} To keep everyone’s business private, we only show your totals.
          </p>

          <Card title="Vendors you’ve referred">
            {!d.referred_bakers.length ? <p className="muted small">No one yet. Share your link to get started.</p> : (
              <ul className="list">
                {d.referred_bakers.map((b) => {
                  const s = PLAN_STATUS[b.plan_status] ?? PLAN_STATUS.inactive;
                  return (
                    <li key={b.name + b.joined_at} className="list-row">
                      <span className="grow">
                        <span className="row-title">{b.name}</span>
                        <span className="row-sub">Joined {formatDate(b.joined_at.length === 10 ? `${b.joined_at}T12:00` : b.joined_at)}</span>
                      </span>
                      <span className="row-end"><Badge tone={s.tone}>{s.label}</Badge></span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      <Card title="Commission breakdown">
        <p className="small">You earn {COMMISSION_PCT}% of what your referral pays for their plan, every time they pay, for as long as their plan stays active. During their first 3 months they get 10% off, so your commission is on the discounted price.</p>
        <table className="table">
          <thead><tr><th>Your referral’s plan</th><th className="num">Your commission</th></tr></thead>
          <tbody>
            {PLANS.map((p) => (
              <tr key={p.tier}>
                <td>{p.name} (Monthly)</td>
                <td className="num">${(Math.round(p.price * COMMISSION_PCT) / 100).toFixed(2)}/month per referral</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">Prices in USD, before tax.</p>
      </Card>

      <Card title="Good to know">
        <ul className="small">
          <li>Vendors who sign up with your link or code get 10% off their first 3 months (monthly plans), or 10% off their first year (yearly plans). It’s applied automatically at checkout.</li>
          <li>You must have an active Bakeri plan to earn commission. If you cancel, you stop earning — even on referrals who are still subscribed.</li>
          <li>Payouts go to your connected Stripe account.</li>
          <li>Referred the wrong way? A referrer can only be changed within 45 days of signup, and only when the referred vendor asks us.</li>
        </ul>
        <p className="small"><a href={REFERRAL_HELP_URL} target="_blank" rel="noreferrer">Read the full Referral Program guide</a></p>
      </Card>
    </div>
  );
}
