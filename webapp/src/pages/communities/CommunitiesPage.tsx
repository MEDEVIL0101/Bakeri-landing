import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listMenuItems, menuImageURL } from '../../lib/menu';
import { communityStats, type CommunityStats } from '../../lib/community';
import { formatMoney } from '../../lib/format';
import { COURSE_PAGE } from '../../lib/courses';
import { CommunitySettings } from '../menu/CourseBuilderPage';

/**
 * Every course and club community the shop runs (sidebar → Communities):
 * members, new messages since the shop last looked, and Design / Manage
 * beside each. iOS: CommunitiesView.
 */
export function CommunitiesPage() {
  const userId = useUserId();
  const items = useLoad(() => (userId ? listMenuItems(userId) : Promise.resolve([])), [userId]);
  const spaces = (items.data ?? []).filter((m) => m.listing_kind === 'digital' && m.is_course);
  const [stats, setStats] = useState<Record<string, CommunityStats>>({});

  useEffect(() => {
    spaces.forEach(async (s) => {
      const st = await communityStats(s.id);
      setStats((c) => ({ ...c, [s.id]: st }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data]);

  if (items.loading) return <div className="page"><Spinner /></div>;
  const all = Object.values(stats);
  const totals = { members: all.reduce((n, s) => n + s.members, 0), fresh: all.reduce((n, s) => n + s.fresh, 0), week: all.reduce((n, s) => n + s.week, 0) };
  return (
    <div className="page">
      <PageHeader title="Communities" subtitle="Every course and club has its own community — a members-only chat with its own page. Design how it looks, and talk with your members as your shop." />
      {items.error && <ErrorBanner message={items.error} />}
      {!spaces.length ? (
        <div className="cx-empty">
          <div className="cx-empty-art" aria-hidden>💬</div>
          <h2>Your first community starts with a course or club</h2>
          <p className="muted">Sell a course or a paid club, and its buyers get a private space: your lessons or library, plus a chat with you and each other.</p>
          <Link className="btn btn-primary" to="/menu/new"><span>Create a course or club</span></Link>
        </div>
      ) : (
        <>
          <div className="cx-totals">
            <div><strong>{spaces.length}</strong><span>communit{spaces.length === 1 ? 'y' : 'ies'}</span></div>
            <div><strong>{totals.members}</strong><span>member{totals.members === 1 ? '' : 's'}</span></div>
            <div><strong>{totals.week}</strong><span>message{totals.week === 1 ? '' : 's'} this week</span></div>
            <div className={totals.fresh ? 'hot' : ''}><strong>{totals.fresh}</strong><span>new for you</span></div>
          </div>
          <div className="cx-grid">
            {spaces.map((s) => <CommunityCard key={s.id} item={s} st={stats[s.id]} />)}
          </div>
        </>
      )}
    </div>
  );
}

function CommunityCard({ item, st }: { item: any; st?: CommunityStats }) {
  const design = item.space_design ?? {};
  const custom = design.style === 'custom';
  const accent = custom && /^#[0-9a-f]{6}$/i.test(design.accent ?? '') ? design.accent : null;
  const cover = design.cover_url || (item.has_image ? menuImageURL(item) : null);
  const price = Number((item.marketplace_price_from ?? 0) > 0 ? item.marketplace_price_from : item.default_price) || 0;
  const billing = item.is_club ? (item.club_interval ? `${formatMoney(price)} / ${item.club_interval}` : `${formatMoney(price)} once`) : formatMoney(price);
  const tabName = (design.community_name ?? '').trim();
  const ago = (iso: string) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  return (
    <article className="cx-card" style={accent ? ({ '--cx-accent': accent } as any) : undefined}>
      <Link to={`/communities/${item.id}`} className={`cx-cover ${cover ? 'has-img' : ''}`} style={cover ? { backgroundImage: `url("${cover}")` } : undefined} aria-label={`Manage ${item.name}`}>
        {!cover && <span className="cx-cover-art" aria-hidden>{item.is_club ? '👥' : '🎓'}</span>}
        <span className="cx-kind">{item.is_club ? 'Club' : 'Course'} · {billing}</span>
        {st && st.fresh > 0 && <span className="cx-new">{st.fresh} new</span>}
      </Link>
      <div className="cx-body">
        <h3 className="cx-title">{item.name}</h3>
        <div className="cx-meta">
          {tabName && <span>“{tabName}”</span>}
          {!item.is_listed_in_marketplace && <span className="cx-warn">Not on your storefront</span>}
          {item.channel_enabled === false && <span className="cx-warn">Chat off</span>}
          <span>{custom ? 'Own style' : 'Website style'}</span>
        </div>
        <div className="cx-stats">
          <div><strong>{st ? st.members : '–'}</strong><span>{item.is_club ? 'member' : 'student'}{st && st.members === 1 ? '' : 's'}</span></div>
          <div><strong>{st ? st.week : '–'}</strong><span>this week</span></div>
          <div><strong>{st ? st.fresh : '–'}</strong><span>new for you</span></div>
        </div>
        <div className="cx-last">
          {st?.last ? (
            <><span className="cx-last-who">{st.last.fromShop ? 'You' : st.last.author}</span>
              <span className="cx-last-text">{st.last.body}</span>
              <span className="cx-last-when">{ago(st.last.at)}</span></>
          ) : <span className="muted">{st ? 'No messages yet — say hello to get it started.' : ' '}</span>}
        </div>
        <div className="cx-actions">
          <Link className="btn btn-secondary" to={`/communities/${item.id}/design`}><span>Design</span></Link>
          <Link className="btn btn-primary" to={`/communities/${item.id}`}><span>Manage{st && st.fresh ? ` · ${st.fresh} new` : ''}</span></Link>
        </div>
      </div>
    </article>
  );
}

/** One community's page design (style, cover, welcome, guidelines) and settings. */
export function CommunityDesignPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const items = useLoad(() => (userId ? listMenuItems(userId) : Promise.resolve([])), [userId]);
  const item = items.data?.find((m) => m.id === id);
  if (items.loading) return <div className="page"><Spinner /></div>;
  if (!item) return <div className="page"><ErrorBanner message="This community couldn’t be found." /></div>;
  return (
    <div className="page">
      <PageHeader back={<Link to="/communities" className="back-link">Communities</Link>} title={`Design · ${item.name}`}
        actions={<Link className="btn btn-primary" to={`/communities/${id}`}><span>Manage</span></Link>} />
      <CommunitySettings item={item} ownerURL={`${COURSE_PAGE}?owner=${id}`} club={!!item.is_club} onSaved={() => items.reload()} />
    </div>
  );
}
