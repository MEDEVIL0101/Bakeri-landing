import { LOGO } from '../lib/brand';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/ui';
import { cancelPendingDeletion } from '../lib/account';
import { TimerPill } from '../pages/kitchen/Timers';
import { STORAGE_PUBLIC_URL, supabase } from '../lib/supabase';

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

const NAV: { heading?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/', label: 'Home', end: true, icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  ] },
  { heading: 'Sell', items: [
    { to: '/storefront', label: 'Storefront', icon: <path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M10 20v-5h4v5" /> },
    { to: '/orders', label: 'Orders', icon: <path d="M6 3h12l1 4H5zM5 7h14v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM9 11h6" /> },
    { to: '/menu', label: 'Menu & Listings', icon: <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" /> },
    { to: '/promotions', label: 'Promotions', icon: <path d="M19 5 5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /> },
    { to: '/forms', label: 'Order Forms', icon: <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4" /> },
  ] },
  { heading: 'Customers', items: [
    { to: '/customers', label: 'Customers', icon: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75" /> },
    { to: '/campaigns', label: 'Email Campaigns', icon: <path d="M3 6h18v12H3zM3 6l9 7 9-7" /> },
  ] },
  { heading: 'Kitchen', items: [
    { to: '/schedule', label: 'Schedule', icon: <path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" /> },
    { to: '/recipes', label: 'Recipes', icon: <path d="M6 3h11a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1z" /> },
    { to: '/ingredients', label: 'Ingredients', icon: <path d="M12 3c3 2.5 4.5 5 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 8 9 5.5 12 3zM12 16v5M8 21h8" /> },
    { to: '/calculator', label: 'Calculator', icon: <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /> },
  ] },
  { heading: 'Money', items: [
    { to: '/finances', label: 'Finances', icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
    { to: '/payouts', label: 'Direct Deposit', icon: <path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z" /> },
  ] },
];

const TABS = ['/', '/orders', '/menu', '/storefront'].map((to) => {
  const item = NAV.flatMap((g) => g.items).find((n) => n.to === to)!;
  return { ...item, label: to === '/menu' ? 'Menu' : item.label };
});

/** New storefront orders / quote requests waiting on the vendor; refreshed every minute. */
function usePendingCount(userId?: string): number {
  const [n, setN] = useState(0);
  const location = useLocation();
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = () => supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('deleted_at', null).eq('order_source', 'marketplace').in('marketplace_status', ['pending', 'pending_quote'])
      .then(({ count }) => { if (alive) setN(count ?? 0); });
    load();
    const i = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(i); };
  }, [userId, location.pathname]);
  return n;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const pending = usePendingCount(session?.user.id);
  const location = useLocation();
  const toast = useToast();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const seg = location.pathname.split('/').filter(Boolean)[0] ?? '';
    const titles: Record<string, string> = {
      '': 'Home', storefront: 'Storefront', orders: 'Orders', menu: 'Menu & Listings', promotions: 'Promotions', forms: 'Order Forms',
      customers: 'Customers', campaigns: 'Email Campaigns', schedule: 'Schedule', recipes: 'Recipes', ingredients: 'Ingredients',
      calculator: 'Calculator', finances: 'Finances', payouts: 'Direct Deposit', settings: 'Settings', 'shop-settings': 'Shop settings', refer: 'Refer a Baker',
    };
    document.title = titles[seg] ? `${titles[seg]} · Bakeri` : 'Bakeri';
  }, [location.pathname]);
  useEffect(() => {
    if (!session) return;
    cancelPendingDeletion(session.user.id).then((cancelled) => {
      if (cancelled) toast('Welcome back — your account deletion has been cancelled.');
    }).catch(() => {});
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const storefront = profile?.profile_slug ? `https://bakeriapp.com/${profile.profile_slug}` : null;

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Icon><path d="M4 6h16M4 12h16M4 18h16" /></Icon>
        </button>
        <img src={LOGO} alt="Bakeri" className="topbar-logo" />
        <span />
      </header>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src={LOGO} alt="Bakeri" />
        </div>
        <div className="sidebar-biz">
          <span className="biz-avatar">
            {!logoFailed && session ? <img src={`${STORAGE_PUBLIC_URL}/business-logos/${session.user.id.toUpperCase()}/logo.jpg`} alt="" onError={() => setLogoFailed(true)} /> : (profile?.business_name ?? 'B')[0]}
          </span>
          <span className="biz-text">
            <span className="biz-name ellipsis">{profile?.business_name}</span>
            {storefront && (
              <a href={storefront} target="_blank" rel="noreferrer" className="biz-link ellipsis">
                bakeriapp.com/{profile?.profile_slug} ↗
              </a>
            )}
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
                  {n.to === '/orders' && pending > 0 && <span className="nav-badge">{pending}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Icon>
            <span>Settings</span>
          </NavLink>
          <div className="sidebar-account">
            <span className="small muted ellipsis">{session?.user.email}</span>
            <button className="link-btn small" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Quick navigation">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <Icon>{t.icon}</Icon>
            <span>{t.label}</span>
            {t.to === '/orders' && pending > 0 && <span className="nav-badge">{pending}</span>}
          </NavLink>
        ))}
        <button className="tab" onClick={() => setOpen(true)}>
          <Icon><path d="M4 6h16M4 12h16M4 18h16" /></Icon>
          <span>More</span>
        </button>
      </nav>
      <TimerPill />
    </div>
  );
}
