import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Spinner, useLoad } from '../../components/ui';
import { formUsage, isAnswerField, listForms } from '../../lib/forms';
import { IMPORT_SOURCES, NEEDS_FILE, importExternalForm, importFormFromFiles, type ImportSource } from '../../lib/formImport';
import { listMenuItems } from '../../lib/menu';
import { formatDate } from '../../lib/format';

/** Mirrors iOS IntakeFormsLibraryView ("Manage Forms"). */
export function FormsPage() {
  const userId = useUserId();
  const { profile } = useAuth();
  const [importing, setImporting] = useState<ImportSource | 'file' | null>(null);
  const forms = useLoad(() => listForms(userId), [userId]);
  const usage = useLoad(() => formUsage(userId), [userId]);
  const items = useLoad(() => listMenuItems(userId), [userId]);
  const siteFormId = profile?.storefront_listing_id
    ? items.data?.find((m) => m.id.toLowerCase() === profile.storefront_listing_id!.toLowerCase())?.intake_form_id?.toLowerCase()
    : undefined;

  return (
    <div className="page">
      <PageHeader title="Order forms" subtitle="Questions customers answer when they request a custom order."
        actions={<>
          <Button variant="ghost" onClick={() => setImporting('google')}>Import Google Form</Button>
          <Button variant="ghost" onClick={() => setImporting('jotform')}>Import JotForm</Button>
          <Button variant="ghost" onClick={() => setImporting('file')}>Import from PDF / screenshots</Button>
          <Link to="/forms/new" className="btn btn-primary" data-icon="plus">New form</Link>
        </>} />
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
      {importing && <ImportFormModal source={importing} onClose={() => setImporting(null)} />}
    </div>
  );
}

/** Mirrors iOS FormImportView: paste a public link (or upload a PDF /
 *  screenshots), then review the result in the builder. */
function ImportFormModal({ source: initial, onClose }: { source: ImportSource | 'file'; onClose: () => void }) {
  const navigate = useNavigate();
  const [source, setSource] = useState<ImportSource | 'file'>(initial);
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsFile, setNeedsFile] = useState(false);
  const fileMode = source === 'file';
  const meta = fileMode ? null : IMPORT_SOURCES[source];

  async function run() {
    if (busy || (fileMode ? !files.length : !url.trim())) return;
    setBusy(true); setErr(null); setNeedsFile(false);
    try {
      const imported = fileMode ? await importFormFromFiles(files) : await importExternalForm(source, url);
      if (!imported.fields.length) throw new Error("Couldn't find any questions in that form. Try rebuilding it by hand instead.");
      navigate('/forms/new', { state: { imported } });
    } catch (e: any) {
      setErr(e.message); setNeedsFile(e?.code === NEEDS_FILE); setBusy(false);
    }
  }

  return (
    <Modal title={fileMode ? 'Import from a PDF or screenshots' : `Import a ${meta!.name}`} onClose={busy ? () => {} : onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} onClick={run} disabled={fileMode ? !files.length : !url.trim()}>Import</Button>
      </>}>
      {fileMode ? (
        <>
          <p className="small muted">For a form that can’t be opened from its link — like a Google Form with a photo upload question — or one on any other site. Upload a PDF printout (File → Print → Save as PDF) or screenshots of every page, in order. Your questions come in ready to review — nothing is saved until you tap Save.</p>
          <label className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
            {files.length ? 'Choose different files' : 'Choose PDF or screenshots'}
            <input type="file" accept="application/pdf,image/*" multiple hidden disabled={busy}
              onChange={(e) => { setFiles(Array.from(e.target.files ?? []).slice(0, 10)); e.target.value = ''; }} />
          </label>
          {files.length > 0 && <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{files.map((f, i) => <li key={i}>{f.name}</li>)}</ul>}
        </>
      ) : (
        <>
          <p className="small muted">{meta!.description}</p>
          <Input value={url} placeholder={meta!.placeholder} disabled={busy} type="url"
            onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} />
        </>
      )}
      {busy && <p className="small muted">Reading its questions and rebuilding them here — this can take a minute for longer forms.</p>}
      {err && <ErrorBanner message={err} />}
      {needsFile && !fileMode && (
        <Button variant="secondary" onClick={() => { setSource('file'); setErr(null); setNeedsFile(false); }}>Upload a PDF or screenshots instead</Button>
      )}
    </Modal>
  );
}
