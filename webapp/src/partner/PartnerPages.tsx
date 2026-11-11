import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useLoad, useToast } from '../components/ui';
import { BarChart } from '../pages/finances/BarChart';
import { formatCents } from '../lib/account';
import { formatDate } from '../lib/format';
import { PLANS, TRIAL_DAYS } from '../lib/plans';
import {
  agreeGuidelines, deleteLead, LEAD_STATUSES, LINK_TARGETS, loadLeads, loadPartnerDashboard, partnerLink,
  payoutDashboardURL, payoutOnboardingURL, payoutStatus, pctLabel, saveLead, termLabel,
  type LeadStatus, type PartnerDashboard, type PartnerLead, type PartnerMe, type PartnerReferral,
} from './partnerApi';

/**
 * Community Growth Partner dashboard pages (routes under /partner). Data:
 * partner_dashboard() / partner_leads / growth-partner-connect.
 */

type Range = 7 | 30 | 90 | 365;
const RANGES: { days: Range; label: string }[] = [
  { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '12 months' },
];

const fmt = (n: number) => n.toLocaleString();
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const day = (iso: string) => formatDate(iso.length === 10 ? `${iso}T12:00` : iso);

function usePartner(): PartnerMe {
  const { partner } = useAuth();
  if (!partner) throw new Error('usePartner outside RequirePartner');
  return partner;
}

function useCopy() {
  const toast = useToast();
  return async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn’t copy — select and copy it instead', 'error'); }
  };
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: ReactNode; tone: string }) {
  return (
    <div className="metric static" style={{ ['--tone' as any]: `var(--chart-${tone})` }}>
      <span className="metric-label"><i />{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

function RangePicker({ days, onChange }: { days: Range; onChange: (d: Range) => void }) {
  return (
    <div className="seg">
      {RANGES.map((r) => (
        <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => onChange(r.days)}>{r.label}</button>
      ))}
    </div>
  );
}

function Bars({ rows }: { rows: { name: string; n: number; note?: string }[] }) {
  const top = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="ins-funnel">
      {rows.map((r, i) => (
        <div key={r.name} className="ins-row">
          <span className="ins-label ellipsis">{r.name}</span>
          <span className="ins-track"><span className="ins-fill" style={{ width: `${Math.min(100, Math.max(2, (r.n / top) * 100))}%`, opacity: 1 - i * 0.14 }} /></span>
          <span className="ins-num">{fmt(r.n)}</span>
          <span className="ins-pct">{r.note ?? ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Daily visitors → bars; weekly on 90 days, monthly on a year. */
function visitorBars(d: PartnerDashboard, days: Range) {
  const by = new Map(d.traffic.daily.map((x) => [x.day.slice(0, 10), x.visitors]));
  const start = new Date(); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const step = days <= 31 ? 1 : days <= 120 ? 7 : 0;
  const out: { label: string; visitors: number }[] = [];
  if (step === 0) {
    const months = new Map<string, { label: string; visitors: number }>();
    for (let i = 0; i < days; i++) {
      const x = new Date(start); x.setDate(start.getDate() + i);
      const k = `${x.getFullYear()}-${x.getMonth()}`;
      const row = months.get(k) ?? { label: x.toLocaleDateString(undefined, { month: 'short' }), visitors: 0 };
      row.visitors += by.get(key(x)) ?? 0;
      months.set(k, row);
    }
    return [...months.values()];
  }
  for (let i = 0; i < days; i += step) {
    const x = new Date(start); x.setDate(start.getDate() + i);
    let n = 0;
    for (let j = 0; j < step && i + j < days; j++) { const y = new Date(x); y.setDate(x.getDate() + j); n += by.get(key(y)) ?? 0; }
    out.push({ label: x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), visitors: n });
  }
  return out;
}

function monthBars(d: PartnerDashboard) {
  const by = new Map(d.money.monthly.map((m) => [m.month, m.cents]));
  const out: { label: string; earned: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const x = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    out.push({ label: x.toLocaleDateString(undefined, { month: 'short' }), earned: (by.get(k) ?? 0) / 100 });
  }
  return out;
}

const CAMPAIGN_NAME = (c: string) => (c === '(none)' ? 'No campaign tag' : c);

// ── Overview ──────────────────────────────────────────────────────────────

export function PartnerOverviewPage() {
  const partner = usePartner();
  const { refreshPartner } = useAuth();
  const [days, setDays] = useState<Range>(30);
  const dash = useLoad(() => loadPartnerDashboard(days), [days]);
  const d = dash.data;
  const copy = useCopy();
  const [agreeing, setAgreeing] = useState(false);

  return (
    <div className="page">
      <PageHeader
        title={`Hi, ${partner.name.split(/\s+/)[0]}`}
        phoneTitle="Overview"
        subtitle={<span>You earn <strong>{pctLabel(partner.commission_rate)}</strong> of every plan payment {termLabel(partner.commission_months)}.</span>}
        actions={<RangePicker days={days} onChange={setDays} />}
      />

      {!partner.agreed_guidelines_at && (
        <div className="banner banner-info">
          <span>Please read and accept the partner guidelines before you start reaching out.</span>
          <Button variant="secondary" loading={agreeing} onClick={async () => { setAgreeing(true); try { await agreeGuidelines(); await refreshPartner(); } finally { setAgreeing(false); } }}>
            I accept
          </Button>
        </div>
      )}
      {!partner.payouts_ready && (
        <div className="banner banner-info">
          <span>Set up payouts so your commission can be paid on the 1st of each month. It’s tracked either way.</span>
          <Link to="/partner/payouts" className="btn btn-secondary">Set up payouts</Link>
        </div>
      )}

      {partner.code && (
        <Card className="hero-card">
          <div className="toolbar" style={{ width: '100%' }}>
            <div>
              <span className="small muted">Your partner code</span>
              <div className="code-display">{partner.code}</div>
            </div>
            <div className="btn-row">
              <Button onClick={() => copy(partnerLink(partner.code!), 'Link')}>Copy my link</Button>
              <Button variant="secondary" onClick={() => copy(partner.code!, 'Code')}>Copy code</Button>
              <Link to="/partner/links" className="btn btn-ghost">Campaign links →</Link>
            </div>
          </div>
        </Card>
      )}

      {dash.loading && !d ? <Spinner /> : dash.error ? <ErrorBanner message="Couldn’t load your dashboard. Try again shortly." onRetry={dash.reload} /> : d && (
        <>
          <div className="metric-grid">
            <Tile label="Link visitors" value={fmt(d.traffic.visitors)} sub={`People who opened your links · ${RANGES.find((r) => r.days === days)?.label}`} tone="3" />
            <Tile label="Sign-ups" value={fmt(d.funnel.signed_up)} sub={`${fmt(d.funnel.signed_up_period)} in this period`} tone="1" />
            <Tile label="On free trial" value={fmt(d.funnel.trialing)} sub={`${TRIAL_DAYS}-day trial, then paid`} tone="2" />
            <Tile label="Paying vendors" value={fmt(d.funnel.paying)} sub="Earning you commission now" tone="4" />
            <Tile label="Earned" value={formatCents(d.money.period_cents, d.money.currency)} sub={`${formatCents(d.money.lifetime_cents, d.money.currency)} all time`} tone="5" />
          </div>

          <Card title="Visitors from your links" className="ins-chart">
            {d.traffic.visitors === 0 ? (
              <p className="muted small">No visits in this period yet. Share your link — every click on it shows up here within a minute.</p>
            ) : (() => {
              const pts = visitorBars(d, days);
              return <BarChart data={pts} labelEvery={Math.max(1, Math.ceil(pts.length / 10))}
                series={[{ key: 'visitors', label: 'Visitors', color: 'var(--chart-3)' }]} format={(n) => n.toLocaleString()} />;
            })()}
          </Card>

          <div className="grid-2 ins-grid">
            <Card title="From click to paying">
              <Bars rows={[
                { name: 'Visited', n: d.traffic.visitors },
                { name: 'Opened sign-up', n: d.traffic.signup_views, note: pct(d.traffic.signup_views, d.traffic.visitors) },
                { name: 'Signed up', n: d.funnel.signed_up_period, note: pct(d.funnel.signed_up_period, d.traffic.visitors) },
              ]} />
              <p className="small muted">Of everyone you’ve ever referred: {fmt(d.funnel.trialing)} on trial, {fmt(d.funnel.paying)} paying, {fmt(d.funnel.inactive)} not subscribed.</p>
            </Card>
            <Card title="Your earnings" actions={<Link to="/partner/payouts" className="small">Payouts →</Link>}>
              <div className="stats">
                <div className="stat stat-hero"><span className="stat-label">Ready to pay</span><span className="stat-value">{formatCents(d.money.available_cents, d.money.currency)}</span></div>
                <div className="stat"><span className="stat-label">Pending</span><span className="stat-value">{formatCents(d.money.pending_cents, d.money.currency)}</span></div>
                <div className="stat"><span className="stat-label">Paid</span><span className="stat-value">{formatCents(d.money.paid_cents, d.money.currency)}</span></div>
              </div>
              <p className="small muted">Next payout: {day(d.money.next_payout_date)} (balances of {formatCents(d.money.minimum_cents, d.money.currency)} or more).</p>
            </Card>
          </div>

          <div className="grid-2 ins-grid">
            <Card title="Campaigns" actions={<Link to="/partner/links" className="small">Make a link →</Link>}>
              {d.traffic.campaigns.length === 0 ? <p className="muted small">Tag links by where you share them (Instagram bio, a newsletter, a workshop) to see which ones bring vendors.</p> : (
                <table className="table compact">
                  <thead><tr><th>Campaign</th><th className="num">Visitors</th><th className="num">Sign-ups</th></tr></thead>
                  <tbody>
                    {d.traffic.campaigns.slice(0, 8).map((c) => (
                      <tr key={c.campaign}><td className="ellipsis">{CAMPAIGN_NAME(c.campaign)}</td><td className="num">{fmt(c.visitors)}</td><td className="num">{fmt(c.signups)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Outreach" actions={<Link to="/partner/outreach" className="small">Open list →</Link>}>
              {d.leads.total === 0 ? <p className="muted small">Keep track of the shops you reach out to. We’ll tell you if a shop is already on Bakerï or someone else is talking to them.</p> : (
                <>
                  <Bars rows={[
                    { name: 'To contact', n: d.leads.new },
                    { name: 'Contacted', n: d.leads.contacted },
                    { name: 'Interested', n: d.leads.interested },
                    { name: 'Signed up', n: d.leads.signed_up },
                  ]} />
                  {d.leads.follow_ups_due > 0 && <p className="small"><Badge tone="gold">{d.leads.follow_ups_due} follow-up{d.leads.follow_ups_due === 1 ? '' : 's'} due</Badge></p>}
                </>
              )}
            </Card>
          </div>

          <Card title="Latest referrals" actions={<Link to="/partner/referrals" className="small">All referrals →</Link>}>
            <ReferralList rows={d.referrals.slice(0, 5)} currency={d.money.currency} />
          </Card>
        </>
      )}
    </div>
  );
}

// ── Links ─────────────────────────────────────────────────────────────────

const CAMPAIGN_IDEAS = ['instagram-bio', 'instagram-dm', 'tiktok', 'newsletter', 'email', 'workshop', 'facebook-group'];

export function PartnerLinksPage() {
  const partner = usePartner();
  const copy = useCopy();
  const [target, setTarget] = useState<string>(LINK_TARGETS[0].base);
  const [campaign, setCampaign] = useState('');
  const dash = useLoad(() => loadPartnerDashboard(365), []);
  const code = partner.code;
  if (!code) return <div className="page page-narrow"><PageHeader title="Links & Code" /><ErrorBanner message="Your code isn’t set up yet. Contact hello@bakeriapp.com and we’ll sort it out." /></div>;

  const link = partnerLink(code, target, campaign);
  const firstName = partner.name.split(/\s+/)[0];
  const templates = [
    {
      title: 'Instagram / TikTok DM',
      text: `Hi! I love what you’re making. I work with Bakerï — a storefront and order system built for food makers (pre-orders, custom cake requests, pickup times, payments). Would it help if I sent you a quick look? You’d get 10% off your first 3 months with my code ${code}. ${partnerLink(code, LINK_TARGETS[0].base, 'instagram-dm')}`,
    },
    {
      title: 'Email to a shop',
      text: `Subject: A storefront built for bakers\n\nHi [name],\n\nI came across [shop] and loved [something specific]. I’m a Community Growth Partner with Bakerï, a link-in-bio storefront and order manager made for food makers — pre-orders, custom order forms, pickup scheduling and card payments in one place.\n\nIf it’s useful, here’s a 7-day free trial with 10% off your first 3 months: ${partnerLink(code, LINK_TARGETS[0].base, 'email')}\n\nHappy to answer any questions.\n\n${firstName}${partner.company ? `\n${partner.company}` : ''}\n(I earn a commission if you join. Reply “no thanks” and I won’t email again.)`,
    },
    {
      title: 'Bio or post line',
      text: `Selling baked goods? I use and recommend Bakerï — try it free with code ${code} (10% off 3 months). ${partnerLink(code, LINK_TARGETS[0].base, 'instagram-bio')} #ad`,
    },
  ];

  return (
    <div className="page">
      <PageHeader title="Links & Code" subtitle="Every link carries your code. Add a campaign tag to see which places bring the most vendors." />

      <div className="grid-2 ins-grid">
        <Card title="Your code">
          <div className="code-display">{code}</div>
          <p className="small muted">Vendors can type this at sign-up instead of using a link. It gives them 10% off their first 3 months.</p>
          <div className="btn-row">
            <Button onClick={() => copy(code, 'Code')}>Copy code</Button>
            <Button variant="secondary" onClick={() => copy(partnerLink(code), 'Link')}>Copy basic link</Button>
          </div>
        </Card>

        <Card title="Build a campaign link">
          <Field label="Where it goes">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              {LINK_TARGETS.map((t) => <option key={t.key} value={t.base}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Campaign tag" hint="Letters and numbers only, e.g. instagram-bio or spring-newsletter.">
            <Input value={campaign} placeholder="instagram-bio" onChange={(e) => setCampaign(e.target.value)} />
          </Field>
          <div className="pills">
            {CAMPAIGN_IDEAS.map((c) => <button key={c} className={`pill ${campaign === c ? 'active' : ''}`} onClick={() => setCampaign(c)}>{c}</button>)}
          </div>
          <div className="copy-row"><code className="ellipsis">{link}</code><Button onClick={() => copy(link, 'Link')}>Copy</Button></div>
        </Card>
      </div>

      <Card title="How each campaign is doing (last 12 months)">
        {dash.loading && !dash.data ? <Spinner /> : !dash.data || dash.data.traffic.campaigns.length === 0 ? (
          <p className="muted small">No clicks yet. Once people open your links, each campaign shows up here.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Campaign</th><th className="num">Visitors</th><th className="num">Sign-ups</th><th className="num">Conversion</th></tr></thead>
              <tbody>
                {dash.data.traffic.campaigns.map((c) => (
                  <tr key={c.campaign}>
                    <td>{CAMPAIGN_NAME(c.campaign)}</td>
                    <td className="num">{fmt(c.visitors)}</td>
                    <td className="num">{fmt(c.signups)}</td>
                    <td className="num">{pct(c.signups, c.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">Visitors are counted once per person per day. Sign-ups here are people who finished the sign-up form after opening your link. Your Referrals page lists everyone attributed to your code.</p>
      </Card>

      <Card title="Ready-to-use messages">
        <p className="small muted">Make them your own — personal notes get far more replies. Keep the commission line and the opt-out line in emails (see <Link to="/partner/guidelines">guidelines</Link>).</p>
        <div className="stack">
          {templates.map((t) => (
            <div key={t.title} className="card">
              <div className="card-header"><h3 className="card-title">{t.title}</h3><Button variant="secondary" onClick={() => copy(t.text, t.title)}>Copy</Button></div>
              <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{t.text}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Referrals ─────────────────────────────────────────────────────────────

const PLAN_STATUS: Record<PartnerReferral['plan_status'], { label: string; tone: 'green' | 'gold' | 'neutral' }> = {
  paying: { label: 'Paying', tone: 'green' },
  trialing: { label: 'On free trial', tone: 'gold' },
  inactive: { label: 'Not subscribed', tone: 'neutral' },
};

function ReferralList({ rows, currency }: { rows: PartnerReferral[]; currency: string }) {
  if (!rows.length) return <p className="muted small">No referrals yet. Vendors who sign up with your link or code appear here.</p>;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>Shop</th><th>Joined</th><th>Plan</th><th className="num">Earned</th><th className="hide-sm">Earns until</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const s = PLAN_STATUS[r.plan_status] ?? PLAN_STATUS.inactive;
            return (
              <tr key={r.id}>
                <td>
                  <span className="row-title">{r.slug ? <a href={`https://bakeriapp.com/${r.slug}`} target="_blank" rel="noreferrer">{r.shop}</a> : r.shop}</span>
                  {r.rate !== 0.2 && <span className="row-sub">{pctLabel(r.rate)} commission</span>}
                </td>
                <td>{day(r.joined_at)}</td>
                <td><Badge tone={s.tone}>{s.label}{r.plan_status !== 'inactive' && r.plan_tier ? ` · ${r.plan_tier[0].toUpperCase()}${r.plan_tier.slice(1)}` : ''}</Badge></td>
                <td className="num">{formatCents(r.earned_cents, currency)}</td>
                <td className="hide-sm">{r.earns_until ? day(r.earns_until) : 'No end date'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PartnerReferralsPage() {
  const dash = useLoad(() => loadPartnerDashboard(365), []);
  const [filter, setFilter] = useState<'all' | PartnerReferral['plan_status']>('all');
  const d = dash.data;
  const rows = d ? d.referrals.filter((r) => filter === 'all' || r.plan_status === filter) : [];

  return (
    <div className="page">
      <PageHeader title="Referrals" subtitle="Every vendor who signed up with your link or code." />
      {dash.loading && !d ? <Spinner /> : dash.error ? <ErrorBanner message="Couldn’t load your referrals." onRetry={dash.reload} /> : d && (
        <>
          <div className="metric-grid">
            <Tile label="Signed up" value={fmt(d.funnel.signed_up)} sub="All time" tone="1" />
            <Tile label="On free trial" value={fmt(d.funnel.trialing)} sub="Commission starts when they pay" tone="2" />
            <Tile label="Paying" value={fmt(d.funnel.paying)} sub={`${pct(d.funnel.paying, d.funnel.signed_up)} of sign-ups`} tone="4" />
            <Tile label="Not subscribed" value={fmt(d.funnel.inactive)} sub="Trial ended or cancelled" tone="3" />
            <Tile label="Earned" value={formatCents(d.money.lifetime_cents, d.money.currency)} sub="All time, before payouts" tone="5" />
          </div>
          <Card title="Vendors" actions={
            <div className="seg">
              {(['all', 'paying', 'trialing', 'inactive'] as const).map((f) => (
                <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : PLAN_STATUS[f].label}
                </button>
              ))}
            </div>
          }>
            <ReferralList rows={rows} currency={d.money.currency} />
          </Card>
          <p className="small muted">A vendor counts as yours when they sign up with your link (we remember it for 30 days) or type your code. Commission is on the plan price they actually pay, after any discount, starting when their {TRIAL_DAYS}-day trial converts.</p>
        </>
      )}
    </div>
  );
}

// ── Outreach ──────────────────────────────────────────────────────────────

const statusInfo = (s: LeadStatus) => LEAD_STATUSES.find((x) => x.value === s) ?? LEAD_STATUSES[0];
const todayYMD = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

export function PartnerOutreachPage() {
  const partner = usePartner();
  const leads = useLoad(loadLeads, []);
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'due' | LeadStatus>('all');
  const [editing, setEditing] = useState<Partial<PartnerLead> | null>(null);
  const all = leads.data ?? [];
  const today = todayYMD();
  const isDue = (l: PartnerLead) => !!l.next_follow_up && l.next_follow_up <= today && l.status !== 'signed_up' && l.status !== 'not_interested';

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((l) => (filter === 'all' || (filter === 'due' ? isDue(l) : l.status === filter))
      && (!needle || [l.shop_name, l.contact_name, l.instagram, l.email, l.website, l.city, l.notes].some((v) => v?.toLowerCase().includes(needle))));
  }, [all, q, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, due: all.filter(isDue).length };
    for (const s of LEAD_STATUSES) c[s.value] = all.filter((l) => l.status === s.value).length;
    return c;
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  async function quickStatus(l: PartnerLead, status: LeadStatus) {
    try {
      const r = await saveLead({ ...l, status, touched: true });
      if (r.status !== 'saved') { toast(r.message, 'error'); return; }
      leads.setData(all.map((x) => (x.id === l.id ? r.lead : x)));
    } catch { toast('Couldn’t update that lead — try again.', 'error'); }
  }

  function exportCSV() {
    const cols: (keyof PartnerLead)[] = ['shop_name', 'contact_name', 'instagram', 'email', 'website', 'city', 'status', 'last_contacted_at', 'next_follow_up', 'notes'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...all.map((l) => cols.map((c) => esc(l[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'bakeri-outreach.csv';
    a.click();
  }

  const disabled = partner.status !== 'active';

  return (
    <div className="page">
      <PageHeader
        title="Outreach"
        subtitle="Your list of shops to reach. Saving a shop claims it for you for 90 days after your last contact."
        actions={<>
          {all.length > 0 && <Button variant="secondary" onClick={exportCSV}>Export CSV</Button>}
          <Button disabled={disabled} onClick={() => setEditing({ status: 'new' })}>Add a shop</Button>
        </>}
      />

      {leads.loading && !leads.data ? <Spinner /> : leads.error ? <ErrorBanner message="Couldn’t load your list." onRetry={leads.reload} /> : (
        <>
          <div className="toolbar">
            <div className="pills">
              <button className={`pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All · {counts.all}</button>
              {counts.due > 0 && <button className={`pill ${filter === 'due' ? 'active' : ''}`} onClick={() => setFilter('due')}>Follow up today · {counts.due}</button>}
              {LEAD_STATUSES.map((s) => counts[s.value] > 0 && (
                <button key={s.value} className={`pill ${filter === s.value ? 'active' : ''}`} onClick={() => setFilter(s.value)}>{s.label} · {counts[s.value]}</button>
              ))}
            </div>
            <Input className="search" type="search" placeholder="Search shops" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {all.length === 0 ? (
            <Card>
              <EmptyState
                title="Start your outreach list"
                body="Add the bakers and food makers you plan to contact. We’ll flag any shop that’s already on Bakerï, or that another partner is already talking to, so nobody gets two pitches."
                action={<Button disabled={disabled} onClick={() => setEditing({ status: 'new' })}>Add your first shop</Button>}
              />
            </Card>
          ) : (
            <Card>
              <div className="table-scroll">
                <table className="table hover">
                  <thead><tr><th>Shop</th><th className="hide-sm">Contact</th><th>Status</th><th className="hide-sm">Last contact</th><th>Follow up</th><th /></tr></thead>
                  <tbody>
                    {shown.map((l) => {
                      const s = statusInfo(l.status);
                      return (
                        <tr key={l.id} className="row-link" onClick={() => setEditing(l)}>
                          <td>
                            <span className="row-title">{l.shop_name}</span>
                            <span className="row-sub">{[l.city, l.contact_name].filter(Boolean).join(' · ')}</span>
                          </td>
                          <td className="hide-sm small">
                            {l.instagram && <div><a href={`https://instagram.com/${l.instagram}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>@{l.instagram}</a></div>}
                            {l.email && <div className="ellipsis">{l.email}</div>}
                            {l.website && <div className="ellipsis muted">{l.website}</div>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <Select value={l.status} disabled={disabled} onChange={(e) => quickStatus(l, e.target.value as LeadStatus)} aria-label={`Status for ${l.shop_name}`}>
                              {LEAD_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                            </Select>
                            <span hidden><Badge tone={s.tone}>{s.label}</Badge></span>
                          </td>
                          <td className="hide-sm small muted">{l.last_contacted_at ? day(l.last_contacted_at) : '—'}</td>
                          <td className="small">{l.next_follow_up ? (isDue(l) ? <Badge tone="gold">{day(l.next_follow_up)}</Badge> : day(l.next_follow_up)) : '—'}</td>
                          <td className="num" onClick={(e) => e.stopPropagation()}>
                            {l.status !== 'signed_up' && l.status !== 'not_interested' && (
                              <Button variant="ghost" disabled={disabled} onClick={() => quickStatus(l, l.status === 'new' ? 'contacted' : l.status)}>
                                {l.status === 'new' ? 'Mark contacted' : 'Log contact'}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shown.length === 0 && <p className="muted small center">No shops match.</p>}
              </div>
            </Card>
          )}
          <p className="small muted">Leads move to “Signed up” on their own when the shop joins with your link or code using the same email. Only you can see your list.</p>
        </>
      )}

      {editing && (
        <LeadEditor
          lead={editing}
          onClose={() => setEditing(null)}
          onSaved={(l) => { leads.setData(editing.id ? all.map((x) => (x.id === l.id ? l : x)) : [l, ...all]); setEditing(null); }}
          onDeleted={(id) => { leads.setData(all.filter((x) => x.id !== id)); setEditing(null); }}
        />
      )}
    </div>
  );
}

function LeadEditor({ lead, onClose, onSaved, onDeleted }: {
  lead: Partial<PartnerLead>; onClose: () => void; onSaved: (l: PartnerLead) => void; onDeleted: (id: string) => void;
}) {
  const [f, setF] = useState<Partial<PartnerLead>>(lead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof PartnerLead) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await saveLead(f);
      if (r.status === 'saved') onSaved(r.lead); else setError(r.message);
    } catch { setError('Couldn’t save — check your connection and try again.'); }
    setBusy(false);
  }

  return (
    <Modal
      title={lead.id ? `Edit ${lead.shop_name}` : 'Add a shop'}
      onClose={onClose}
      footer={<>
        {lead.id && (confirmDelete
          ? <Button variant="danger" onClick={async () => { await deleteLead(lead.id!); onDeleted(lead.id!); }}>Remove for good</Button>
          : <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Remove</Button>)}
        <span className="grow" />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!f.shop_name?.trim()} onClick={() => submit()}>{lead.id ? 'Save' : 'Add shop'}</Button>
      </>}
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Shop name"><Input required value={f.shop_name ?? ''} onChange={set('shop_name')} placeholder="Sweet Crumbs Bakery" /></Field>
        <div className="grid-2">
          <Field label="Instagram"><Input value={f.instagram ?? ''} onChange={set('instagram')} placeholder="@sweetcrumbs" /></Field>
          <Field label="Email"><Input type="email" value={f.email ?? ''} onChange={set('email')} placeholder="hello@sweetcrumbs.ca" /></Field>
        </div>
        <div className="grid-2">
          <Field label="Website"><Input value={f.website ?? ''} onChange={set('website')} placeholder="sweetcrumbs.ca" /></Field>
          <Field label="City"><Input value={f.city ?? ''} onChange={set('city')} /></Field>
        </div>
        <div className="grid-2">
          <Field label="Contact name"><Input value={f.contact_name ?? ''} onChange={set('contact_name')} /></Field>
          <Field label="Status">
            <Select value={f.status ?? 'new'} onChange={set('status')}>
              {LEAD_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Follow up on"><Input type="date" value={f.next_follow_up ?? ''} onChange={set('next_follow_up')} /></Field>
        <Field label="Notes"><Textarea rows={4} value={f.notes ?? ''} onChange={set('notes')} placeholder="What they make, what you talked about, what they need…" /></Field>
        {error && <ErrorBanner message={error} />}
        <p className="small muted">Add an Instagram handle, email or website so we can check the shop isn’t already on Bakerï or claimed by another partner.</p>
      </form>
    </Modal>
  );
}

// ── Payouts ───────────────────────────────────────────────────────────────

const COUNTRIES = [{ code: 'CA', name: 'Canada' }, { code: 'US', name: 'United States' }];

export function PartnerPayoutsPage() {
  const partner = usePartner();
  const { refreshPartner } = useAuth();
  const [params] = useSearchParams();
  const status = useLoad(payoutStatus, []);
  const dash = useLoad(() => loadPartnerDashboard(365), []);
  const [country, setCountry] = useState(partner.country === 'US' ? 'US' : 'CA');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = dash.data;
  const s = status.data;

  // Back from Stripe: re-read the account (status() also stores it).
  useEffect(() => { if (params.get('connected')) { status.reload(); refreshPartner(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s && s.ready !== partner.payouts_ready) refreshPartner(); }, [s?.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  async function go(kind: 'onboard' | 'dashboard') {
    setBusy(true); setErr(null);
    try {
      window.location.href = kind === 'onboard' ? await payoutOnboardingURL(country) : await payoutDashboardURL();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t open Stripe. Try again.'); setBusy(false); }
  }

  return (
    <div className="page">
      <PageHeader title="Earnings & Payouts" subtitle="Commission is paid to your bank through Stripe on the 1st of each month." />

      <Card title="Payout account">
        {status.loading && !s ? <Spinner /> : status.error ? <ErrorBanner message={status.error} onRetry={status.reload} /> : s?.ready ? (
          <div className="toolbar">
            <span><Badge tone="green">Ready</Badge> <span className="small">Payouts go to the bank account on your Stripe Express account.</span></span>
            <Button variant="secondary" loading={busy} onClick={() => go('dashboard')}>Open Stripe</Button>
          </div>
        ) : (
          <div className="stack">
            <p className="small">
              {s?.has_account
                ? 'Your Stripe account needs a few more details before we can pay you.'
                : 'Stripe handles payouts for us. It takes about five minutes: your name, date of birth, address and bank account, so you’re verified and paid in your own currency.'}
            </p>
            {!s?.has_account && (
              <Field label="Country you’ll be paid in">
                <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            <div><Button loading={busy} disabled={partner.status !== 'active'} onClick={() => go('onboard')}>{s?.has_account ? 'Finish setting up payouts' : 'Set up payouts'}</Button></div>
          </div>
        )}
        {err && <ErrorBanner message={err} />}
        {params.get('connected') && s && !s.ready && <p className="small muted">Back from Stripe. If you finished, it can take a minute to show as ready — refresh shortly.</p>}
      </Card>

      {dash.loading && !d ? <Spinner /> : d && (
        <>
          <div className="metric-grid">
            <Tile label="Ready to pay" value={formatCents(d.money.available_cents, d.money.currency)} sub={`Pays ${day(d.money.next_payout_date)}`} tone="4" />
            <Tile label="Pending" value={formatCents(d.money.pending_cents, d.money.currency)} sub="Clears 4 days after each payment" tone="2" />
            <Tile label="Paid to you" value={formatCents(d.money.paid_cents, d.money.currency)} sub="All time" tone="1" />
            <Tile label="Lifetime earned" value={formatCents(d.money.lifetime_cents, d.money.currency)} sub="Before payouts" tone="5" />
            <Tile label="Your rate" value={pctLabel(partner.commission_rate)} sub={partner.commission_months ? `First ${partner.commission_months} months per vendor` : 'No end date'} tone="3" />
          </div>

          <Card title="Commission earned by month">
            <BarChart data={monthBars(d)} series={[{ key: 'earned', label: 'Earned', color: 'var(--chart-4)' }]}
              format={(n) => formatCents(Math.round(n * 100), d.money.currency)} />
          </Card>

          <div className="grid-2 ins-grid">
            <Card title="Payout history">
              {d.payouts.length === 0 ? <p className="muted small">No payouts yet. Your first one goes out on the 1st once {formatCents(d.money.minimum_cents, d.money.currency)} or more is ready.</p> : (
                <table className="table compact">
                  <thead><tr><th>Date</th><th>Status</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {d.payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{day(p.created_at)}</td>
                        <td>{p.status === 'paid' ? <Badge tone="green">Paid</Badge> : <Badge tone="red">Failed</Badge>}</td>
                        <td className="num">{formatCents(p.amount_cents, p.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="What you earn per vendor">
              <table className="table compact">
                <thead><tr><th>Their plan</th><th className="num">You earn</th></tr></thead>
                <tbody>
                  {PLANS.map((p) => (
                    <tr key={p.tier}><td>{p.name} monthly</td><td className="num">${(p.price * partner.commission_rate).toFixed(2)}/month</td></tr>
                  ))}
                  {PLANS.map((p) => (
                    <tr key={p.tier + 'y'}><td>{p.name} yearly</td><td className="num">${(p.yearPrice * partner.commission_rate).toFixed(2)}/year</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">USD, on the full price — slightly less during a vendor’s first 3 months while their 10% referral discount applies.</p>
            </Card>
          </div>

          <Card title="Good to know">
            <ul className="small">
              <li>Commission is earned on each plan payment a referred vendor makes, {termLabel(partner.commission_months)}.</li>
              <li>Each earning is held for 4 days in case of a refund, then it’s ready. Payouts run on the 1st when {formatCents(d.money.minimum_cents, d.money.currency)} or more is ready — smaller balances roll over.</li>
              <li>Refunded or disputed payments are taken back from a later payout.</li>
              <li>You’re paid as an independent partner, not an employee — you’re responsible for reporting this income and any sales tax that applies to you. Stripe may ask for tax details.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Guidelines ────────────────────────────────────────────────────────────

export function PartnerGuidelinesPage() {
  const partner = usePartner();
  const { refreshPartner } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="page page-narrow">
      <PageHeader title="Partner Guidelines" subtitle="How the Community Growth Partner program works, and how to represent Bakerï well." />

      <Card title="Your terms">
        <p>You earn <strong>{pctLabel(partner.commission_rate)}</strong> of every Bakerï plan payment from each vendor you refer, {termLabel(partner.commission_months)}. Vendors you refer get 10% off their first 3 months (or their first year on yearly plans).</p>
        <p className="small muted">Paid monthly on the 1st through Stripe once {formatCents(2000, 'usd')} or more is ready. Prices and commission are in USD.</p>
      </Card>

      <Card title="Who counts as your referral">
        <ul className="small">
          <li>A vendor is yours when they sign up through your link (we remember it in their browser for 30 days) or enter your code at sign-up.</li>
          <li>The code used at sign-up wins. If a vendor used someone else’s code, they stay with that referrer — claims on your outreach list don’t change attribution.</li>
          <li>If a vendor tells us they meant to use your code, we can switch it within 45 days of their sign-up.</li>
          <li>You can’t refer yourself, a business you own, or an existing Bakerï vendor.</li>
        </ul>
      </Card>

      <Card title="Outreach list and claims">
        <ul className="small">
          <li>Adding a shop to your outreach list claims it for 90 days after your last contact, so two partners never pitch the same shop.</li>
          <li>Shops already on Bakerï can’t be added — there’s no need to contact them.</li>
          <li>A shop that says “no thanks” is released. Please don’t contact them again about Bakerï.</li>
        </ul>
      </Card>

      <Card title="Cold outreach and anti-spam law">
        <p className="small">Messages to businesses you don’t already know are covered by anti-spam law — Canada’s CASL and the US CAN-SPAM Act. To stay on the right side of both:</p>
        <ul className="small">
          <li><strong>Only email addresses a business publishes itself</strong> (on its website or social profile), with no “no solicitation” note, and keep the message about their business.</li>
          <li><strong>Say who you are</strong>: your name, that you’re a Bakerï partner, and how to reach you.</li>
          <li><strong>Make it easy to say no</strong>: include a line like “Reply ‘no thanks’ and I won’t email again”, and honour it right away.</li>
          <li>No bought or scraped email lists, no mass blasts, no automated DMs.</li>
          <li>Respect platform rules — Instagram and TikTok limit unsolicited bulk messages. One genuine, personal message beats ten copies.</li>
        </ul>
      </Card>

      <Card title="Representing Bakerï">
        <ul className="small">
          <li><strong>Disclose the relationship.</strong> When you recommend Bakerï in public posts, say you earn a commission (#ad, “partner link”). Creators in the US and Canada are required to.</li>
          <li><strong>Keep claims honest.</strong> Describe features and prices as they are on bakeriapp.com. Don’t promise discounts, features or income we don’t offer.</li>
          <li><strong>No paid ads on our name.</strong> Don’t bid on “Bakeri” or “Bakerï” in search ads, or run paid ads that look like they come from Bakerï.</li>
          <li><strong>Don’t speak for Bakerï.</strong> You’re an independent partner, not an employee — don’t sign up vendors on their behalf, handle their payments, or make commitments for us.</li>
          <li>Use the logo and screenshots from bakeriapp.com as they are. Ask before making anything new with our brand.</li>
        </ul>
      </Card>

      <Card title="Changes and ending the partnership">
        <ul className="small">
          <li>Either side can end the partnership at any time. Commission already earned is still paid.</li>
          <li>Breaking these guidelines — spam, misleading claims, self-referrals, paid brand ads — can pause or end the partnership and cancel commission tied to it.</li>
          <li>We’ll email you before any change to your terms. Questions: <a href="mailto:hello@bakeriapp.com">hello@bakeriapp.com</a>.</li>
        </ul>
      </Card>

      {partner.agreed_guidelines_at ? (
        <p className="small muted">You accepted these guidelines on {day(partner.agreed_guidelines_at)}.</p>
      ) : (
        <div><Button loading={busy} onClick={async () => { setBusy(true); try { await agreeGuidelines(); await refreshPartner(); } finally { setBusy(false); } }}>I’ve read and accept these guidelines</Button></div>
      )}
    </div>
  );
}
