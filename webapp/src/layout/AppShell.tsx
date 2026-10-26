import { LOGO } from '../lib/brand';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmModal, useToast } from '../components/ui';
import { cancelPendingDeletion } from '../lib/account';
import { TimerPill } from '../pages/kitchen/Timers';
import { STORAGE_PUBLIC_URL, supabase } from '../lib/supabase';
import { useIsPhone } from '../lib/useMedia';
import { NavSlotsContext, type NavSlots } from './NavBar';
import { ThemeSheet } from './ThemeSheet';
import { asPattern, asTheme, backdropStyle, themeVars, type PatternName, type ThemeName } from '../lib/theme';

// soon: shown greyed out with a "Coming soon" tag and not clickable.
type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; soon?: boolean };

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
    { to: '/campaigns', label: 'Email Campaigns', soon: true, icon: <path d="M3 6h18v12H3zM3 6l9 7 9-7" /> },
  ] },
  { heading: 'Kitchen', items: [
    { to: '/schedule', label: 'Schedule', icon: <path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" /> },
    { to: '/recipes', label: 'Recipes', icon: <path d="M6 3h11a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1z" /> },
    { to: '/calculator', label: 'Calculator', icon: <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /> },
  ] },
  { heading: 'Costs', items: [
    { to: '/ingredients', label: 'Ingredients', icon: <path d="M12 3c3 2.5 4.5 5 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 8 9 5.5 12 3zM12 16v5M8 21h8" /> },
    { to: '/packaging', label: 'Packaging', icon: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" /> },
  ] },
  { heading: 'Money', items: [
    { to: '/finances', label: 'Finances', icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
    { to: '/payouts', label: 'Direct Deposit', icon: <path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z" /> },
  ] },
];

// Phone tab bar — the iOS app's four tabs, in its order and with its names.
// Home and Recipes are side-menu-only there too.
const TABS: NavItem[] = [
  { to: '/schedule', label: 'Schedule', icon: <path d="M4 5.5h16v14.5H4zM4 10h16M8 3v4M16 3v4" /> },
  { to: '/orders', label: 'Orders', icon: <path d="M6 2.5h12v19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 7.5h6M9 11.5h6M9 15.5h3.5" /> },
  { to: '/menu', label: 'Products', icon: <path fill="currentColor" stroke="none" fillRule="evenodd" d="M3 4a1 1 0 0 1 1-1h7.2a1 1 0 0 1 .7.3l8.8 8.8a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0L3.3 11.9a1 1 0 0 1-.3-.7zm4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /> },
  { to: '/storefront', label: 'Storefront', icon: <path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M10 20v-5h4v5" /> },
];

// Phone side menu — ProfileSidebarView's rows first, in its order, then the
// web-only tools the app reaches from inside other screens.
const PHONE_MENU: NavItem[] = [
  { to: '/', label: 'Home', end: true, icon: <path fill="currentColor" stroke="none" d="M11.3 2.6a1 1 0 0 1 1.4 0l8.6 7.9a1 1 0 0 1 .3.7V20a1 1 0 0 1-1 1h-5v-6.5H8.4V21h-5a1 1 0 0 1-1-1v-8.8a1 1 0 0 1 .3-.7z" /> },
  { to: '/recipes', label: 'Recipes', icon: <path d="M4 5.5C6.5 4 9.5 4 12 5.5v14c-2.5-1.5-5.5-1.5-8 0zM20 5.5c-2.5-1.5-5.5-1.5-8 0v14c2.5-1.5 5.5-1.5 8 0z" /> },
  { to: '/forms', label: 'Manage Forms', icon: <path d="M9 3.5h6a1 1 0 0 1 1 1v1H8v-1a1 1 0 0 1 1-1zM8 5.5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1h-2M8.5 11h.01M11 11h4.5M8.5 15h.01M11 15h4.5" /> },
  { to: '/orders?filter=closed', label: 'Past Orders', icon: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.2l2.7 2.7L16 9.6" /> },
  { to: '/finances', label: 'Financial Overview', icon: <path fill="currentColor" stroke="none" d="M4 13h3.5v8H4zM10.25 4h3.5v17h-3.5zM16.5 9H20v12h-3.5z" /> },
  { to: '/ingredients', label: 'Ingredients', icon: <path d="M14.5 9.5 4 20M14.5 9.5c1.5-1.5 4-1.5 5 0s0 3.5-1.5 5L8.5 20H4v-4.5zM15 4c0 2 1 3.5 3 4M20 4c-2 0-3.5 1-4 3" /> },
  { to: '/packaging', label: 'Packaging', icon: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" /> },
  { to: '/payouts', label: 'Direct Deposit', icon: <path fill="currentColor" stroke="none" fillRule="evenodd" d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1H2zm0 3.5h20V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM5 15h5v1.5H5z" /> },
];
const PHONE_MENU_MORE: NavItem[] = [
  { to: '/customers', label: 'Customers', icon: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75" /> },
  { to: '/campaigns', label: 'Email Campaigns', soon: true, icon: <path d="M3 6h18v12H3zM3 6l9 7 9-7" /> },
  { to: '/promotions', label: 'Promotions', icon: <path d="M19 5 5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /> },
  { to: '/calculator', label: 'Calculator', icon: <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /> },
];

const THEME_BOLD = new Set<ThemeName>(['Ember', 'Sage', 'Blueberry', 'Honey', 'Fall']);

// Same day-aware cold launch as MainTabView.isFirstColdLaunchToday(): the
// first open of the day lands on Home, any later one on Schedule. Only the
// first route of a page load counts, so tapping Home later still works.
let coldLaunchHandled = false;
const LAST_OPEN_KEY = 'bakeri.lastOpenDay';
function coldLaunchRoute(path: string): string | null {
  if (coldLaunchHandled) return null;
  coldLaunchHandled = true;
  if (path !== '/') return null;
  const today = new Date().toDateString();
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_OPEN_KEY); localStorage.setItem(LAST_OPEN_KEY, today); } catch { /* private mode */ }
  return last === today ? '/schedule' : null;
}

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

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, session, signOut, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const pending = usePendingCount(session?.user.id);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const phone = useIsPhone();
  const [slots, setSlots] = useState<NavSlots>({ leading: null, title: null, trailing: null });
  // Stable callbacks: an inline ref callback is re-run (null, then the node)
  // on every render, which would set state on every render.
  const slotRef = useCallback((key: keyof NavSlots) => (el: HTMLElement | null) => {
    if (el) setSlots((s) => (s[key] === el ? s : { ...s, [key]: el }));
  }, []);
  const [leadingRef, titleRef, trailingRef] = useState(() => [slotRef('leading'), slotRef('title'), slotRef('trailing')])[0];
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  // Theme + background, as the app stores them on the profile. Local copy so
  // a tap repaints at once; saved in the background like CustomizeThemeSheet.
  const [look, setLook] = useState<{ theme: ThemeName; pattern: PatternName }>({ theme: 'Classic', pattern: 'Standard' });
  useEffect(() => {
    setLook({ theme: asTheme(profile?.selected_theme), pattern: asPattern(profile?.background_pattern) });
  }, [profile?.selected_theme, profile?.background_pattern]);
  const changeLook = async (theme: ThemeName, pattern: PatternName) => {
    const prev = look;
    setLook({ theme, pattern });
    if (!session) return;
    const { error } = await supabase.from('profiles')
      .update({ selected_theme: theme, background_pattern: pattern, updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') })
      .eq('id', session.user.id);
    if (error) { setLook(prev); toast('Couldn’t save your theme — try again.', 'error'); return; }
    refreshProfile();
  };
  const seg = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const titles: Record<string, string> = {
    '': 'Home', storefront: 'Storefront', orders: 'Orders', menu: 'Menu & Listings', promotions: 'Promotions', forms: 'Order Forms',
    customers: 'Customers', campaigns: 'Email Campaigns', schedule: 'Schedule', recipes: 'Recipes', ingredients: 'Ingredients', packaging: 'Packaging',
    calculator: 'Calculator', finances: 'Finances', payouts: 'Direct Deposit', settings: 'Settings', 'shop-settings': 'Shop settings', refer: 'Refer a Vendor',
  };
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    document.title = titles[seg] ? `${titles[seg]} · Bakeri` : 'Bakeri';
  }, [seg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!phone) return;
    const to = coldLaunchRoute(location.pathname);
    if (to) navigate(to, { replace: true });
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps
  // The drawer slides over the page; keep the page from scrolling under it.
  useEffect(() => {
    document.body.classList.toggle('drawer-open', open && phone);
    return () => document.body.classList.remove('drawer-open');
  }, [open, phone]);
  useEffect(() => {
    if (!session) return;
    cancelPendingDeletion(session.user.id).then((cancelled) => {
      if (cancelled) toast('Welcome back — your account deletion has been cancelled.');
    }).catch(() => {});
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const storefront = profile?.profile_slug ? `https://bakeriapp.com/${profile.profile_slug}` : null;
  const logoURL = session ? `${STORAGE_PUBLIC_URL}/business-logos/${session.user.id.toUpperCase()}/logo.jpg` : null;
  const initial = ((profile?.user_name || profile?.business_name || 'B').trim()[0] ?? 'B').toUpperCase();
  const avatar = (cls: string) => (
    <span className={cls}>{!logoFailed && logoURL ? <img src={logoURL} alt="" onError={() => setLogoFailed(true)} /> : initial}</span>
  );

  return (
    <NavSlotsContext.Provider value={phone ? slots : null}>
    <div className={`shell${phone && THEME_BOLD.has(look.theme) ? ' theme-bold' : ''}${phone && look.pattern !== 'Standard' ? ' has-pattern' : ''}`} style={phone ? themeVars(look.theme) : undefined}>
      {phone && <div className="app-bg" style={backdropStyle(look.theme, look.pattern)} aria-hidden />}
      {phone && (
        <header className="topbar">
          <div className="nav-leading" ref={leadingRef}>
            <button className="nav-avatar" aria-label="Open menu" onClick={() => setOpen(true)}>{avatar('nav-avatar-img')}</button>
          </div>
          <div className="nav-title" ref={titleRef}>
            <span className="nav-default-title ellipsis">{titles[seg] === 'Menu & Listings' ? 'Products' : titles[seg]}</span>
          </div>
          <div className="nav-trailing" ref={trailingRef} />
        </header>
      )}

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      {phone && (
        <aside className={`phone-menu ${open ? 'open' : ''}`} aria-hidden={!open}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).dataset.x = String(e.touches[0].clientX); }}
          onTouchEnd={(e) => { const x0 = Number((e.currentTarget as HTMLElement).dataset.x); if (e.changedTouches[0].clientX - x0 < -50) setOpen(false); }}>
          <div className="pm-head">
            {avatar('pm-avatar')}
            <div className="pm-biz">{profile?.business_name?.trim() || 'My Shop'}</div>
            {profile?.user_name && <div className="pm-name">{profile.user_name}</div>}
            {storefront && <a href={storefront} target="_blank" rel="noreferrer" className="pm-link ellipsis">bakeriapp.com/{profile?.profile_slug} ↗</a>}
          </div>
          <nav className="pm-rows">
            {PHONE_MENU.map((n) => (
              <Link key={n.to} to={n.to} className="pm-row" onClick={() => setOpen(false)}>
                <Icon size={22}>{n.icon}</Icon>
                <span>{n.label}</span>
              </Link>
            )).flatMap((row, i) => i === 1 ? [row, (
              <button key="theme" className="pm-row" onClick={() => { setOpen(false); setThemeOpen(true); }}>
                <Icon size={22}><path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.4-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3zM7.5 12.5h.01M9 8h.01M14 7h.01M17.5 10h.01" /></Icon>
                <span>Customize Theme</span>
              </button>
            )] : [row])}
          </nav>
          <div className="pm-more">
            {PHONE_MENU_MORE.map((n) => n.soon ? (
              <span key={n.to} className="pm-row-sm nav-soon" aria-disabled="true">
                <Icon size={18}>{n.icon}</Icon>
                <span>{n.label}</span>
                <span className="nav-soon-tag">Coming soon</span>
              </span>
            ) : (
              <Link key={n.to} to={n.to} className="pm-row-sm" onClick={() => setOpen(false)}>
                <Icon size={18}>{n.icon}</Icon>
                <span>{n.label}</span>
              </Link>
            ))}
          </div>
          <div className="pm-foot">
            <Link to="/settings" className="pm-row-sm" onClick={() => setOpen(false)}>
              <Icon size={18}><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.2 18.4a6.5 6.5 0 0 1 11.6 0" /></Icon>
              <span>Profile &amp; Settings</span>
            </Link>
            <Link to="/settings?help=1" className="pm-row-sm" onClick={() => setOpen(false)}>
              <Icon size={18}><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17h.01" /></Icon>
              <span>Help Center</span>
            </Link>
            <button className="pm-row pm-signout" onClick={() => setConfirmSignOut(true)}>
              <Icon size={22}><path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8M10 12h11M17.5 8.5 21 12l-3.5 3.5" /></Icon>
              <span>Sign Out</span>
            </button>
          </div>
        </aside>
      )}
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
              {g.items.map((n) => n.soon ? (
                <span key={n.to} className="nav-item nav-soon" aria-disabled="true">
                  <Icon>{n.icon}</Icon>
                  <span>{n.label}</span>
                  <span className="nav-soon-tag">Coming soon</span>
                </span>
              ) : (
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
      {phone && (
        <nav className="tabbar" aria-label="Tabs">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab ${isActive && !(t.to === '/orders' && location.search.includes('filter=closed')) ? 'active' : ''}`}>
              <Icon size={24}>{t.icon}</Icon>
              <span>{t.label}</span>
              {t.to === '/orders' && pending > 0 && <span className="nav-badge">{pending}</span>}
            </NavLink>
          ))}
        </nav>
      )}
      <TimerPill />
      {themeOpen && <ThemeSheet theme={look.theme} pattern={look.pattern} onChange={changeLook} onClose={() => setThemeOpen(false)} />}
      {confirmSignOut && (
        <ConfirmModal title="Sign Out" body="Are you sure you want to sign out?" confirmLabel="Sign Out" danger
          onConfirm={async () => { setConfirmSignOut(false); await signOut(); }} onClose={() => setConfirmSignOut(false)} />
      )}
    </div>
    </NavSlotsContext.Provider>
  );
}
