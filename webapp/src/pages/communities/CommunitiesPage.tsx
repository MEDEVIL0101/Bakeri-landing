import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { EmptyState, ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listMenuItems } from '../../lib/menu';
import { communityMemberCount, communityNewCount } from '../../lib/community';
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
  const [counts, setCounts] = useState<Record<string, { members: number; fresh: number }>>({});

  useEffect(() => {
    spaces.forEach(async (s) => {
      const [members, fresh] = await Promise.all([communityMemberCount(s.id), communityNewCount(s.id)]);
      setCounts((c) => ({ ...c, [s.id]: { members, fresh } }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data]);

  if (items.loading) return <div className="page"><Spinner /></div>;
  return (
    <div className="page">
      <PageHeader title="Communities" subtitle="A chat for each course and club. Design its page, and manage the conversation as your shop." />
      {items.error && <ErrorBanner message={items.error} />}
      {!spaces.length ? (
        <EmptyState title="No communities yet"
          body="Every course and club you create gets its own community. Create one from Menu & Listings → New → Course or Club." />
      ) : (
        <div className="community-list">
          {spaces.map((s) => {
            const c = counts[s.id];
            return (
              <div key={s.id} className="card community-row">
                <div className="community-row-main">
                  <span className="community-icon" aria-hidden>{s.is_club ? '👥' : '🎓'}</span>
                  <div className="grow">
                    <div className="row-title">{s.name}</div>
                    <div className="small muted">
                      {[s.is_club ? 'Club' : 'Course', c ? `${c.members} ${s.is_club ? 'member' : 'student'}${c.members === 1 ? '' : 's'}` : null,
                        s.is_listed_in_marketplace ? null : 'not listed'].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {c && c.fresh > 0 && <span className="nav-badge">{c.fresh} new</span>}
                </div>
                <div className="row-gap">
                  <Link className="btn btn-secondary" to={`/communities/${s.id}/design`}><span>Design</span></Link>
                  <Link className="btn btn-primary" to={`/communities/${s.id}`}><span>Manage</span></Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
