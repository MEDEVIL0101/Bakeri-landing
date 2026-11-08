import { Link, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listMenuItems } from '../../lib/menu';
import { COURSE_PAGE } from '../../lib/courses';
import { CommunitySettings } from '../menu/CourseBuilderPage';

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
      <PageHeader back={<Link to={item.is_club ? '/clubs' : '/courses'} className="back-link">{item.is_club ? 'Clubs' : 'Courses'}</Link>} title={`Design · ${item.name}`}
        actions={<Link className="btn btn-primary" to={`/communities/${id}`}><span>Manage</span></Link>} />
      <CommunitySettings item={item} ownerURL={`${COURSE_PAGE}?owner=${id}`} club={!!item.is_club} onSaved={() => items.reload()} />
    </div>
  );
}
