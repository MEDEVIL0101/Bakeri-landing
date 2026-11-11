import { LOGO } from '../lib/brand';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmModal } from '../components/ui';
import { useIsPhone } from '../lib/useMedia';
import { backdropStyle, themeVars } from '../lib/theme';
import type { PartnerMe } from './partnerApi';

/**
 * The Community Growth Partner dashboard's frame — the vendor AppShell's
 * sidebar, topbar and tab bar classes, with the partner's own sections.
 */

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

const NAV: { heading?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/partner', label: 'Overview', end: true, icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  ] },
  { heading: 'Grow', items: [
    { to: '/partner/links', label: 'Links & Code', icon: <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /> },
    { to: '/partner/outreach', label: 'Outreach', icon: <path d="M3 6h18v12H3zM3 6l9 7 9-7" /> },
    { to: '/partner/referrals', label: 'Referrals', icon: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75" /> },
  ] },
  { heading: 'Earn', items: [
    { to: '/partner/payouts', label: 'Earnings & Payouts', icon: <path d="M3 7h18v12H3zM3 11h18M7 15h3" /> },
  ] },
  { heading: 'Help', items: [
    { to: '/partner/guidelines', label: 'Partner Guidelines', icon: <path d="M6 3h11a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1z" /> },
  ] },
];

const TABS: NavItem[] = [
  { to: '/partner', label: 'Overview', end: true, icon: NAV[0].items[0].icon },
  { to: '/partner/links', label: 'Links', icon: NAV[1].items[0].icon },
  { to: '/partner/outreach', label: 'Outreach', icon: NAV[1].items[1].icon },
  { to: '/partner/referrals', label: 'Referrals', icon: NAV[1].items[2].icon },
  { to: '/partner/payouts', label: 'Payouts', icon: NAV[2].items[0].icon },
];

const TITLES: Record<string, string> = {
  '': 'Overview', links: 'Links & Code', outreach: 'Outreach', referrals: 'Referrals', payouts: 'Earnings & Payouts', guidelines: 'Partner Guidelines',
};

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function PartnerShell({ partner, children }: { partner: PartnerMe; children: ReactNode }) {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const seg = location.pathname.split('/').filter(Boolean)[1] ?? '';

  useEffect(() => setOpen(false), [location.pathname]);
  // The drawer slides over the page; keep the page from scrolling under it.
  useEffect(() => {
    document.body.classList.toggle('drawer-open', open && phone);
    return () => document.body.classList.remove('drawer-open');
  }, [open, phone]);
  useEffect(() => { document.title = `${TITLES[seg] ?? 'Partner'} · Bakerï Growth Partners`; }, [seg]);

  const initial = (partner.name.trim()[0] ?? 'P').toUpperCase();

  return (
    <div className="shell partner-shell" style={phone ? themeVars('Classic') : undefined}>
      {phone && <div className="app-bg" style={backdropStyle('Classic', 'Standard')} aria-hidden />}
      {phone && (
        <header className="topbar">
          <div className="nav-leading">
            <button className="nav-avatar" aria-label="Open menu" onClick={() => setOpen(true)}>
              <span className="nav-avatar-img">{initial}</span>
            </button>
          </div>
          <div className="nav-title">
            <span className="nav-default-title ellipsis">{TITLES[seg] ?? 'Partner'}</span>
          </div>
          <div className="nav-trailing" />
        </header>
      )}
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      {phone && (
        <aside className={`phone-menu ${open ? 'open' : ''}`} aria-hidden={!open}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).dataset.x = String(e.touches[0].clientX); }}
          onTouchEnd={(e) => { const x0 = Number((e.currentTarget as HTMLElement).dataset.x); if (e.changedTouches[0].clientX - x0 < -50) setOpen(false); }}>
          <div className="pm-head">
            <span className="pm-avatar">{initial}</span>
            <div className="pm-biz">{partner.company || partner.name}</div>
            <div className="pm-name">Community Growth Partner{partner.code ? ` · ${partner.code}` : ''}</div>
          </div>
          <nav className="pm-rows">
            {NAV.flatMap((g) => g.items).map((n) => (
              <Link key={n.to} to={n.to} className="pm-row" onClick={() => setOpen(false)}>
                <Icon size={22}>{n.icon}</Icon>
                <span>{n.label}</span>
              </Link>
            ))}
          </nav>
          <div className="pm-foot">
            {partner.has_shop && (
              <Link to="/" className="pm-row-sm" onClick={() => setOpen(false)}>
                <Icon size={18}><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M10 20v-5h4v5" /></Icon>
                <span>Go to my shop</span>
              </Link>
            )}
            <a href="mailto:hello@bakeriapp.com?subject=Growth%20Partner%20question" className="pm-row-sm">
              <Icon size={18}><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17h.01" /></Icon>
              <span>Contact the team</span>
            </a>
            <button className="pm-row pm-signout" onClick={() => setConfirmSignOut(true)}>
              <Icon size={22}><path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8M10 12h11M17.5 8.5 21 12l-3.5 3.5" /></Icon>
              <span>Sign Out</span>
            </button>
          </div>
        </aside>
      )}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src={LOGO} alt="Bakerï" />
        </div>
        <div className="sidebar-biz">
          <span className="biz-avatar">{initial}</span>
          <span className="biz-text">
            <span className="biz-name ellipsis">{partner.company || partner.name}</span>
            <span className="biz-link ellipsis">Community Growth Partner{partner.code ? ` · ${partner.code}` : ''}</span>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((g, gi) => (
            <div key={gi} className="nav-group">
              {g.heading && <div className="nav-heading">{g.heading}</div>}
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Icon>{n.icon}</Icon>
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {partner.has_shop && (
            <Link to="/" className="nav-item">
              <Icon><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M10 20v-5h4v5" /></Icon>
              <span>Go to my shop</span>
            </Link>
          )}
          <a href="mailto:hello@bakeriapp.com?subject=Growth%20Partner%20question" className="nav-item">
            <Icon><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17h.01" /></Icon>
            <span>Contact the team</span>
          </a>
          <div className="sidebar-account">
            <span className="small muted ellipsis" title={session?.user.email ?? ''}>{session?.user.email}</span>
            <button className="sidebar-signout" onClick={() => setConfirmSignOut(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {partner.status !== 'active' && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner banner-info">
              {partner.status === 'paused'
                ? 'Your partnership is paused, so new sign-ups aren’t earning commission right now. Contact hello@bakeriapp.com with any questions.'
                : 'Your partnership has ended. Earnings already made are still paid out as usual.'}
            </div>
          </div>
        )}
        {children}
      </main>
      {phone && (
        <nav className="tabbar" aria-label="Tabs" style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
              <Icon size={24}>{t.icon}</Icon>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      {confirmSignOut && (
        <ConfirmModal title="Sign Out" body="Are you sure you want to sign out?" confirmLabel="Sign Out" danger
          onConfirm={async () => { setConfirmSignOut(false); await signOut(); }} onClose={() => setConfirmSignOut(false)} />
      )}
    </div>
  );
}
