import { Link } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { formUsage, isAnswerField, listForms } from '../../lib/forms';
import { listMenuItems } from '../../lib/menu';
import { formatDate } from '../../lib/format';

/** Mirrors iOS IntakeFormsLibraryView ("Manage Forms"). */
export function FormsPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const forms = useLoad(() => listForms(userId), [userId]);
  const usage = useLoad(() => formUsage(userId), [userId]);
  const items = useLoad(() => listMenuItems(userId), [userId]);
  const siteFormId = profile?.storefront_listing_id
    ? items.data?.find((m) => m.id.toLowerCase() === profile.storefront_listing_id!.toLowerCase())?.intake_form_id?.toLowerCase()
    : undefined;

  return (
    <div className="page">
      <PageHeader title="Order forms" subtitle="Questions customers answer when they request a custom order."
        actions={<Link to="/forms/new" className="btn btn-primary">New form</Link>} />
      {forms.error && <ErrorBanner message={forms.error} onRetry={forms.reload} />}
      {forms.loading && !forms.data ? <Spinner /> : !forms.data?.length ? (
        <Card>
          <EmptyState title="No forms yet"
            body="Build a custom order form and attach it to any Custom Order listing — it replaces the default questions customers see."
            action={<Link to="/forms/new" className="btn btn-primary">Create your first form</Link>} />
        </Card>
      ) : (
        <div className="tile-grid">
          {forms.data.map((f) => {
            const n = f.fields.filter((x) => isAnswerField(x.field_type)).length;
            const used = usage.data?.[f.id.toLowerCase()] ?? [];
            return (
              <Link key={f.id} to={`/forms/${f.id}`} className="tile">
                <div className="tile-top">
                  <span className="tile-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4" /></svg>
                  </span>
                  {siteFormId === f.id.toLowerCase() && <Badge tone="green">Whole storefront</Badge>}
                </div>
                <span className="tile-title">{f.title || 'Untitled form'}</span>
                <span className="small muted">{n} question{n === 1 ? '' : 's'} · Updated {formatDate(f.updated_at)}</span>
                <span className="small muted ellipsis">{used.length ? `Used by ${used.join(', ')}` : 'Not attached to a listing yet'}</span>
              </Link>
            );
          })}
        </div>
      )}
      <p className="small muted">Importing a Google Form or JotForm is available in the Bakeri iPhone app.</p>
    </div>
  );
}
