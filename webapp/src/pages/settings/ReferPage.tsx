import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorBanner, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import { formatCents, getOrCreateReferralCode, referralDashboard, referralLink } from '../../lib/account';
import { formatDate } from '../../lib/format';

/** Mirrors iOS ReferABakerView. */
export function ReferPage() {
  const toast = useToast();
  const dash = useLoad(() => referralDashboard(), []);
  const [claiming, setClaiming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = dash.data;

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn’t copy — select and copy it instead', 'error'); }
  }

  return (
    <div className="page page-narrow">
      <PageHeader back={<Link to="/settings" className="back-link">← Settings</Link>} title="Refer a Baker" />
      <Card className="hero-card">
        <h2 className="hero-title">Earn 20% of Bakeri’s service fees — about 1% of every sale — from bakers you bring to Bakeri.</h2>
        <p className="muted">Share your code or link. When a new baker enters it as they apply to join and starts selling, your earnings add up automatically and pay out on the 1st of each month to your Stripe account.</p>
      </Card>

      {dash.loading && !d ? <Spinner /> : dash.error ? <ErrorBanner message="Couldn’t load your referrals right now. Try again shortly." onRetry={dash.reload} /> : d && !d.eligible ? (
        <Card>
          <p><strong>Finish setting up payments with Stripe to join the referral program.</strong></p>
          <p className="muted small">Once your Stripe account is connected, come back here for your code.</p>
          <div><Link to="/payouts" className="btn btn-primary">Set up Direct Deposit</Link></div>
        </Card>
      ) : d && (
        <>
          <Card title="Your code">
            {d.code ? (
              <>
                <div className="code-display">{d.code}</div>
                <div className="copy-row"><span className="ellipsis grow">{referralLink(d.code)}</span></div>
                <div className="btn-row">
                  <Button onClick={() => copy(referralLink(d.code!), 'Link')}>Copy link</Button>
                  <Button variant="secondary" onClick={() => copy(d.code!, 'Code')}>Copy code</Button>
                  {'share' in navigator && (
                    <Button variant="ghost" onClick={() => navigator.share({ text: `Join me on Bakeri — use my referral code ${d.code} when you apply.`, url: referralLink(d.code!) }).catch(() => {})}>Share…</Button>
                  )}
                </div>
              </>
            ) : (
              <div><Button loading={claiming} onClick={async () => {
                setClaiming(true); setErr(null);
                try { await getOrCreateReferralCode(); dash.reload(); }
                catch { setErr('Couldn’t create your code — make sure your Stripe setup is finished, then try again.'); }
                setClaiming(false);
              }}>Get my referral code</Button></div>
            )}
            {err && <ErrorBanner message={err} />}
          </Card>

          <div className="stats">
            <div className="stat stat-hero"><span className="stat-label">Available next payout</span><span className="stat-value">{formatCents(d.available_cents, d.currency)}</span></div>
            <div className="stat"><span className="stat-label">Pending</span><span className="stat-value">{formatCents(d.pending_cents, d.currency)}</span></div>
            <div className="stat"><span className="stat-label">Paid to date</span><span className="stat-value">{formatCents(d.paid_cents, d.currency)}</span></div>
          </div>
          <p className="small muted">
            Earnings clear 14 days after each sale, and once a referred baker has made $100 in sales. Paid on the 1st of each month.
            {d.next_payout_date ? ` Next payout: ${formatDate(`${d.next_payout_date.slice(0, 10)}T12:00`)}.` : ''}
          </p>

          <Card title="Bakers you’ve referred">
            {!d.referred_bakers.length ? <p className="muted small">No one yet. Share your code to get started.</p> : (
              <ul className="list">
                {d.referred_bakers.map((b) => (
                  <li key={b.name + b.joined_at} className="list-row">
                    <span className="grow">
                      <span className="row-title">{b.name}</span>
                      <span className="row-sub">Joined {formatDate(b.joined_at.length === 10 ? `${b.joined_at}T12:00` : b.joined_at)}</span>
                    </span>
                    <span className="row-end">
                      <span className="row-amount">{formatCents(b.lifetime_commission_cents, d.currency)}</span>
                      <Badge tone={b.status === 'selling' ? 'green' : 'neutral'}>{b.status.replace(/_/g, ' ')}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
