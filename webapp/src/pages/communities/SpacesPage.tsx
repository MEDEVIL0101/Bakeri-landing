import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listMenuItems, menuImageURL } from '../../lib/menu';
import { communityStats, type CommunityStats } from '../../lib/community';
import { formatMoney } from '../../lib/format';
import { supabase } from '../../lib/supabase';

/**
 * Courses / Clubs (sidebar → Sell): each course or club in one place —
 * its content, community, members and sales page — instead of mixed in
 * with Products. iOS: SpacesView.
 */
export function SpacesPage({ club }: { club: boolean }) {
  const userId = useUserId();
  const items = useLoad(() => (userId ? listMenuItems(userId) : Promise.resolve([])), [userId]);
  const spaces = (items.data ?? []).filter((m) => m.listing_kind === 'digital' && m.is_course && !!m.is_club === club);
  const [stats, setStats] = useState<Record<string, CommunityStats & { lessons: number }>>({});
  const [q, setQ] = useState('');

  useEffect(() => {
    spaces.forEach(async (s) => {
      const [st, lessons] = await Promise.all([
        communityStats(s.id),
        supabase.from('course_lessons').select('id', { count: 'exact', head: true }).eq('menu_item_id', s.id).is('deleted_at', null).then((r) => r.count ?? 0),
      ]);
      setStats((c) => ({ ...c, [s.id]: { ...st, lessons } }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data]);

  if (items.loading) return <div className="page"><Spinner /></div>;
  const kind = club ? 'club' : 'course';
  const shown = spaces.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="page">
      <PageHeader title={club ? 'Clubs' : 'Courses'}
        subtitle={club
          ? 'Paid memberships: a library of resources and a members-only community, billed monthly, yearly or once.'
          : 'Lessons in modules, free previews, and a discussion for your students — lifetime access once they buy.'}
        actions={<Link to={`/menu/new?type=${kind}`} className="btn btn-primary" data-icon="plus">New {kind}</Link>} />
      {items.error && <ErrorBanner message={items.error} />}
      {!spaces.length ? (
        <div className="cx-empty">
          <div className="cx-empty-art" aria-hidden>{club ? '👥' : '🎓'}</div>
          <h2>{club ? 'Start a paid club' : 'Create your first course'}</h2>
          <p className="muted">{club
            ? 'Members pay monthly or yearly for your recipes, videos and a private community chat with you.'
            : 'Turn what you know into lessons — videos, recipes and files — that people buy once and keep.'}</p>
          <Link className="btn btn-primary" to={`/menu/new?type=${kind}`}><span>New {kind}</span></Link>
        </div>
      ) : (
        <>
          {spaces.length > 6 && (
            <div className="toolbar"><input className="input search" type="search" placeholder={`Search ${kind}s…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          )}
          <div className="cx-grid">
            {shown.map((s) => <SpaceCard key={s.id} item={s} st={stats[s.id]} />)}
          </div>
        </>
      )}
    </div>
  );
}

function SpaceCard({ item, st }: { item: any; st?: CommunityStats & { lessons: number } }) {
  const design = item.space_design ?? {};
  const cover = design.cover_url || (item.has_image ? menuImageURL(item) : null);
  const price = Number((item.marketplace_price_from ?? 0) > 0 ? item.marketplace_price_from : item.default_price) || 0;
  const billing = item.is_club ? (item.club_interval ? `${formatMoney(price)} / ${item.club_interval}` : `${formatMoney(price)} once`) : formatMoney(price);
  const people = item.is_club ? 'member' : 'student';
  return (
    <article className="cx-card">
      <Link to={`/menu/${item.id}/course`} className={`cx-cover ${cover ? 'has-img' : ''}`} style={cover ? { backgroundImage: `url("${cover}")` } : undefined}>
        {!cover && <span className="cx-cover-art" aria-hidden>{item.is_club ? '👥' : '🎓'}</span>}
        <span className="cx-kind">{billing}</span>
        {st && st.fresh > 0 && <span className="cx-new">{st.fresh} new</span>}
      </Link>
      <div className="cx-body">
        <h3 className="cx-title">{item.name}</h3>
        <div className="cx-meta">
          <span className={item.is_listed_in_marketplace ? '' : 'cx-warn'}>{item.is_listed_in_marketplace ? 'On your storefront' : 'Not on your storefront'}</span>
        </div>
        <div className="cx-stats">
          <div><strong>{st ? st.members : '–'}</strong><span>{people}{st && st.members === 1 ? '' : 's'}</span></div>
          <div><strong>{st ? st.lessons : '–'}</strong><span>{item.is_club ? 'in library' : 'lessons'}</span></div>
          <div><strong>{st ? st.week : '–'}</strong><span>chats this week</span></div>
        </div>
        <div className="sp-actions">
          <Link className="btn btn-primary" to={`/menu/${item.id}/course`}><span>{item.is_club ? 'Library & members' : 'Lessons & students'}</span></Link>
          <Link className="btn btn-secondary" to={`/communities/${item.id}`}><span>Community{st && st.fresh ? ` · ${st.fresh}` : ''}</span></Link>
          <Link className="btn btn-secondary" to={`/menu/${item.id}`}><span>Sales page & price</span></Link>
          <Link className="btn btn-secondary" to={`/campaigns/new?members=${item.id}`}><span>Email {item.is_club ? 'members' : 'students'}</span></Link>
        </div>
      </div>
    </article>
  );
}
