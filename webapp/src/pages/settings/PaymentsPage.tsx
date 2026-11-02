import { Link } from 'react-router-dom';
import { PageHeader, useLoad } from '../../components/ui';
import { formatCents, referralDashboard } from '../../lib/account';

/**
 * Payments (Harvey 2026-11-02): one place for money in — Direct Deposit
 * (Stripe payouts, tips) and the Referral Program (moved here from
 * Settings). Mirrors the iPhone app's side menu → Payments.
 */
export function PaymentsPage() {
  const referral = useLoad(() => referralDashboard(), []);
  const r = referral.data;
  const referralSub = !r
    ? 'Earn 20% of their plan · they get 10% off'
    : !r.eligible ? 'Choose a plan to unlock'
      : r.referred_count === 0 ? (r.code ? `Share ${r.code} · they get 10% off` : 'Earn 20% of their plan · they get 10% off')
        : `${r.referred_count === 1 ? '1 vendor' : `${r.referred_count} vendors`} referred · ${formatCents(r.available_cents + r.pending_cents + r.paid_cents, r.currency)} earned`;

  return (
    <div className="page page-narrow">
      <PageHeader title="Payments" subtitle="Getting paid, and earning from the vendors you refer." />
      <div className="stack-lg">
        <Link to="/payouts" className="promo-card">
          <span className="promo-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z" /></svg>
          </span>
          <span className="grow">
            <span className="row-title">Direct Deposit</span>
            <span className="row-sub">Get paid for storefront orders, straight to your bank. Tips too.</span>
          </span>
          <span className="chev" aria-hidden>›</span>
        </Link>
        <Link to="/refer" className="promo-card">
          <span className="promo-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
          </span>
          <span className="grow">
            <span className="row-title">Referral Program</span>
            <span className="row-sub">{referralSub}</span>
          </span>
          <span className="chev" aria-hidden>›</span>
        </Link>
      </div>
    </div>
  );
}
