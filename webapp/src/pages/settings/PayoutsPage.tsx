import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Badge, Button, Card, ConfirmModal, ErrorBanner, Field, PageHeader, Select, Spinner, useLoad } from '../../components/ui';
import {
  CONNECT_COUNTRIES, connectOnboardingURL, connectStatus, disconnectStripe, formatCents, payoutSummary, txnLabel,
} from '../../lib/account';
import { formatDate } from '../../lib/format';

/** Mirrors iOS BankingPaymentsView / BakerPayoutSetupView ("Direct Deposit"). */
export function PayoutsPage() {
  const userId = useUserId();
  const { profile, refreshProfile } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = useLoad(() => connectStatus(userId), [userId]);
  const returned = params.get('stripe') === 'return';

  // Coming back from Stripe: refresh the cached profile flag once.
  useEffect(() => {
    if (returned && status.data) { refreshProfile(); }
  }, [returned, status.data, refreshProfile]);

  if (status.loading && !status.data) return <div className="page page-narrow"><Spinner label="Checking your Stripe account…" /></div>;
  const s = status.data ?? { complete: false, accountId: null };

  return (
    <div className="page page-narrow">
      <PageHeader title="Direct Deposit" subtitle="Get paid for storefront orders, straight to your bank." />
      {returned && !s.complete && (
        <div className="banner banner-info">Stripe still needs a few details before you can take payments. Pick up where you left off below.</div>
      )}
      {returned && s.complete && (
        <div className="banner banner-success" role="status">You’re all set — your storefront can take payments.
          <button className="link-btn" onClick={() => setParams({})}>Dismiss</button>
        </div>
      )}
      {s.complete ? <Connected onChange={() => { status.reload(); refreshProfile(); }} />
        : <Setup hasAccount={!!s.accountId} defaultCountry={profile?.country ?? 'US'} onChange={() => { status.reload(); refreshProfile(); }} />}

      <Card title="How payments work">
        <p className="muted small">
          Bakeri’s service fee is 5% of each sale, and Stripe deducts its card processing fee. The rest goes into your own Stripe account as soon as a customer is charged. Payouts to your bank are managed in your Stripe dashboard.
        </p>
      </Card>
    </div>
  );
}

function Setup({ hasAccount, defaultCountry, onChange }: { hasAccount: boolean; defaultCountry: string; onChange: () => void }) {
  const [country, setCountry] = useState(CONNECT_COUNTRIES.some((c) => c.code === defaultCountry) ? defaultCountry : 'US');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [startOver, setStartOver] = useState(false);

  return (
    <Card className="hero-card">
      <div className="hero-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z" /></svg>
      </div>
      <h2 className="hero-title">{hasAccount ? 'Finish setting up payouts' : 'Connect your bank account'}</h2>
      <p className="muted">Bakeri uses Stripe to send your earnings directly to your bank. Setup takes about 2 minutes.</p>
      {!hasAccount && (
        <Field label="Where is your business based?" hint="This can’t be changed after setup.">
          <Select value={country} onChange={(e) => setCountry(e.target.value)}>
            {CONNECT_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      {err && <ErrorBanner message={err} />}
      <Button loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { window.location.href = await connectOnboardingURL(country); }
        catch (e: any) { setErr(e.message); setBusy(false); }
      }}>{hasAccount ? 'Continue with Stripe' : 'Set up payouts with Stripe'}</Button>
      {hasAccount && (
        <>
          <button className="link-btn small muted" onClick={() => setStartOver(true)}>Picked the wrong country? Start over</button>
          <p className="field-hint">Abandons the incomplete Stripe setup so you can pick a country and reconnect from scratch.</p>
        </>
      )}
      {startOver && (
        <ConfirmModal title="Start over?" body="Your incomplete Stripe setup is abandoned so you can choose a country and connect again." confirmLabel="Start over" danger
          onClose={() => setStartOver(false)} onConfirm={async () => { await disconnectStripe(); onChange(); }} />
      )}
    </Card>
  );
}

function Connected({ onChange }: { onChange: () => void }) {
  const summary = useLoad(() => payoutSummary(), []);
  const [disconnecting, setDisconnecting] = useState(false);
  const d = summary.data;

  return (
    <>
      <div className="stats stats-2">
        <div className="stat stat-hero">
          <span className="stat-label">Available</span>
          <span className="stat-value">{d ? formatCents(d.available_cents, d.currency) : '—'}</span>
          <span className="small muted">Ready to pay out</span>
        </div>
        <div className="stat">
          <span className="stat-label">Pending</span>
          <span className="stat-value">{d ? formatCents(d.pending_cents, d.currency) : '—'}</span>
          <span className="small muted">On its way from recent sales</span>
        </div>
      </div>
      {summary.error && <ErrorBanner message={summary.error} onRetry={summary.reload} />}

      <Card title="Payouts" actions={d?.dashboard_login_url ? <a className="btn btn-primary" href={d.dashboard_login_url} target="_blank" rel="noreferrer">Open Stripe Dashboard ↗</a> : null}>
        <div className="btn-row">
          <Badge tone="green">Stripe connected</Badge>
          {d && <Badge tone={d.has_bank_account ? 'blue' : 'gold'}>{d.has_bank_account ? 'Bank account added' : 'No bank account yet'}</Badge>}
        </div>
        <p className="muted small">New sales take a few days to move from Pending to Available, per Stripe’s schedule. Your payout schedule, instant payouts, and bank details are all managed in your Stripe dashboard.</p>
      </Card>

      <Card title="Recent activity">
        {summary.loading && !d ? <Spinner /> : !d?.recent_transactions.length ? <p className="muted small">No activity yet.</p> : (
          <div className="table-scroll"><table className="table">
            <thead><tr><th>Date</th><th>Type</th><th className="num">Amount</th><th className="num">Net</th><th>Status</th></tr></thead>
            <tbody>
              {d.recent_transactions.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.created_at)}</td>
                  <td>{txnLabel(t.type)}</td>
                  <td className="num">{formatCents(t.amount_cents, d.currency)}</td>
                  <td className="num">{formatCents(t.net_cents, d.currency)}</td>
                  <td><Badge tone={t.status === 'available' ? 'green' : 'neutral'}>{t.status === 'available' ? 'Available' : `Available ${formatDate(t.available_on, { month: 'short', day: 'numeric' })}`}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title="Stripe account">
        <p className="muted small">Disconnecting stops your storefront taking orders for products until you connect a Stripe account again. Your products and order history aren’t affected.</p>
        <div><Button variant="secondary" onClick={() => setDisconnecting(true)}>Disconnect Stripe</Button></div>
      </Card>
      {disconnecting && (
        <ConfirmModal title="Disconnect Stripe?" body="Your storefront will stop taking orders for products until you connect a Stripe account again." confirmLabel="Disconnect" danger
          onClose={() => setDisconnecting(false)} onConfirm={async () => { await disconnectStripe(); onChange(); }} />
      )}
    </>
  );
}
