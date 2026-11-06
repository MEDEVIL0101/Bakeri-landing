import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, PageHeader, Spinner, Toggle, useLoad, useToast } from '../../components/ui';
import { ContentBlocksEditor } from '../../components/ContentBlocksEditor';
import { listMenuItems } from '../../lib/menu';
import {
  COURSE_PAGE, addLesson, addModule, addStudent, deleteLesson, deleteModule, emailStudentLink, listStudents, loadCourse,
  reorder, saveLesson, setStudentAccess, updateModule, type CourseLesson, type CourseModule,
} from '../../lib/courses';

/**
 * Course builder (Courses, 2026-11-06): modules and lessons on the left, the
 * selected lesson on the right (title, free preview, content blocks — video,
 * text, photos, files), and a Students tab. iOS: CourseBuilderView.swift.
 */
export function CourseBuilderPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const toast = useToast();
  const items = useLoad(() => (userId ? listMenuItems(userId) : Promise.resolve([])), [userId]);
  const item = items.data?.find((m) => m.id === id);
  const [tab, setTab] = useState<'lessons' | 'students'>('lessons');
  const [modules, setModules] = useState<CourseModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<CourseLesson | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!id) return;
    loadCourse(id).then((m) => { setModules(m); const first = m[0]?.lessons[0]; if (first) open(first); }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const lessonCount = useMemo(() => (modules ?? []).reduce((n, m) => n + m.lessons.length, 0), [modules]);

  function open(l: CourseLesson) {
    if (dirty && draft && !window.confirm('You have unsaved changes to this lesson. Leave without saving?')) return;
    setSelected(l.id); setDraft({ ...l, blocks: l.blocks.map((b) => ({ ...b })) }); setDirty(false);
  }

  function replaceLesson(l: CourseLesson) {
    setModules((ms) => (ms ?? []).map((m) => ({ ...m, lessons: m.lessons.map((x) => (x.id === l.id ? l : x)) })));
  }

  async function run(fn: () => Promise<void>) {
    try { setError(null); await fn(); } catch (e: any) { setError(e.message ?? 'Something went wrong.'); }
  }

  const newModule = () => run(async () => {
    const m = await addModule(userId!, id, `Module ${(modules?.length ?? 0) + 1}`, modules?.length ?? 0);
    setModules([...(modules ?? []), m]);
  });

  const newLesson = (m: CourseModule) => run(async () => {
    const l = await addLesson(userId!, id, m.id, 'New lesson', m.lessons.length);
    setModules((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, lessons: [...x.lessons, l] } : x)));
    open(l);
  });

  const renameModule = (m: CourseModule, title: string) => {
    setModules((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, title } : x)));
  };

  const moveModule = (i: number, by: number) => run(async () => {
    const ms = (modules ?? []).slice(), j = i + by;
    if (j < 0 || j >= ms.length) return;
    [ms[i], ms[j]] = [ms[j], ms[i]];
    setModules(ms.map((m, k) => ({ ...m, sort_order: k })));
    await reorder('course_modules', ms.map((m) => m.id));
  });

  const moveLesson = (m: CourseModule, i: number, by: number) => run(async () => {
    const ls = m.lessons.slice(), j = i + by;
    if (j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    setModules((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, lessons: ls.map((l, k) => ({ ...l, sort_order: k })) } : x)));
    await reorder('course_lessons', ls.map((l) => l.id));
  });

  async function save() {
    if (!draft) return;
    setSaving(true);
    await run(async () => {
      await saveLesson(draft);
      replaceLesson(draft);
      setDirty(false);
      toast('Lesson saved');
    });
    setSaving(false);
  }

  const setD = (patch: Partial<CourseLesson>) => { if (draft) { setDraft({ ...draft, ...patch }); setDirty(true); } };

  if (items.loading || !modules) return <div className="page"><Spinner /></div>;
  if (!item) return <div className="page"><ErrorBanner message="This course couldn’t be found." /></div>;

  const header = (
    <PageHeader
      back={<Link to={`/menu/${id}`} className="back-link">{item.name}</Link>}
      title="Course content"
      subtitle={`${modules.length} module${modules.length === 1 ? '' : 's'} · ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}`}
      actions={
        <div className="row-gap">
          <div className="seg">
            <button className={tab === 'lessons' ? 'active' : ''} onClick={() => setTab('lessons')}>Lessons</button>
            <button className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>Students</button>
          </div>
          <a className="btn btn-secondary" href={`${COURSE_PAGE}?preview=${id}`} target="_blank" rel="noreferrer"><span>Preview</span></a>
        </div>
      }
    />
  );

  return (
    <div className="page">
      {header}
      {error && <ErrorBanner message={error} />}
      {tab === 'students' ? <Students menuItemId={id} userId={userId!} /> : (
        <div className="course-grid">
          <div className="course-outline">
            {modules.length === 0 && (
              <EmptyState title="Start with a module" body="A module is a section of your course — e.g. “Tempering basics”. Add lessons inside it." />
            )}
            {modules.map((m, mi) => (
              <div className="co-module" key={m.id}>
                <div className="co-module-head">
                  <input className="co-module-title" value={m.title} onChange={(e) => renameModule(m, e.target.value)}
                    onBlur={(e) => run(() => updateModule(m.id, { title: e.target.value.trim() || 'Module' }))} />
                  <div className="cb-block-tools">
                    <button type="button" onClick={() => moveModule(mi, -1)} disabled={mi === 0} aria-label="Move module up">↑</button>
                    <button type="button" onClick={() => moveModule(mi, 1)} disabled={mi === modules.length - 1} aria-label="Move module down">↓</button>
                    <button type="button" aria-label="Delete module" onClick={() => setConfirm({
                      title: `Delete “${m.title}”?`, body: `Its ${m.lessons.length} lesson${m.lessons.length === 1 ? '' : 's'} will be removed for every student.`,
                      run: async () => { await deleteModule(m.id); setModules((ms) => (ms ?? []).filter((x) => x.id !== m.id)); if (m.lessons.some((l) => l.id === selected)) { setSelected(null); setDraft(null); } },
                    })}>✕</button>
                  </div>
                </div>
                {m.lessons.map((l, li) => (
                  <div className={`co-lesson ${selected === l.id ? 'active' : ''}`} key={l.id}>
                    <button type="button" className="co-lesson-open" onClick={() => open(l)}>
                      <span className="co-num">{li + 1}</span>
                      <span className="co-lesson-title">{(selected === l.id && draft ? draft.title : l.title) || 'Untitled lesson'}</span>
                      {l.is_preview && <span className="co-tag">Preview</span>}
                    </button>
                    <div className="cb-block-tools">
                      <button type="button" onClick={() => moveLesson(m, li, -1)} disabled={li === 0} aria-label="Move lesson up">↑</button>
                      <button type="button" onClick={() => moveLesson(m, li, 1)} disabled={li === m.lessons.length - 1} aria-label="Move lesson down">↓</button>
                    </div>
                  </div>
                ))}
                <button type="button" className="cb-add-btn" onClick={() => newLesson(m)}>+ Lesson</button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={newModule}>+ Add module</Button>
          </div>

          <div className="course-lesson">
            {!draft ? (
              <Card><p className="muted">Pick a lesson on the left, or add one.</p></Card>
            ) : (
              <Card title="Lesson" actions={
                <div className="row-gap">
                  {dirty && <span className="small muted">Unsaved changes</span>}
                  <Button type="button" onClick={save} loading={saving} disabled={!dirty}>Save lesson</Button>
                </div>
              }>
                <Field label="Title"><Input value={draft.title} onChange={(e) => setD({ title: e.target.value })} placeholder="Tempering chocolate three easy ways" /></Field>
                <Toggle checked={draft.is_preview} onChange={(v) => setD({ is_preview: v })} label="Free preview"
                  hint="Anyone can watch this lesson from your product page — a taster before they buy." />
                <ContentBlocksEditor userId={userId!} blocks={draft.blocks} course
                  onChange={(fn) => { setDraft((d) => (d ? { ...d, blocks: fn(d.blocks) } : d)); setDirty(true); }} />
                <div className="row-gap" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                  <button type="button" className="link-btn small" onClick={() => setConfirm({
                    title: `Delete “${draft.title}”?`, body: 'It will be removed for every student.',
                    run: async () => {
                      await deleteLesson(draft.id);
                      setModules((ms) => (ms ?? []).map((m) => ({ ...m, lessons: m.lessons.filter((x) => x.id !== draft.id) })));
                      setSelected(null); setDraft(null); setDirty(false);
                    },
                  })}>Delete lesson</button>
                  <Button type="button" onClick={save} loading={saving} disabled={!dirty}>Save lesson</Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmModal title={confirm.title} body={confirm.body} confirmLabel="Delete" danger
          onConfirm={async () => { const c = confirm; setConfirm(null); await run(c.run); }} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

function Students({ menuItemId, userId }: { menuItemId: string; userId: string }) {
  const toast = useToast();
  const students = useLoad(() => listStudents(menuItemId), [menuItemId]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true); setErr(null);
    try { await addStudent(userId, menuItemId, email, name); setEmail(''); setName(''); toast('Added — their link is on its way'); students.reload(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

  return (
    <div className="stack-lg">
      <Card title="Add a student" actions={<span className="small muted">For gifts, comps, or someone who paid another way</span>}>
        <div className="grid-2">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@email.com" /></Field>
          <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        {err && <p className="small warn-text">{err}</p>}
        <Button type="button" onClick={add} loading={busy} disabled={!email.trim()}>Give access & email their link</Button>
      </Card>
      <Card title={`Students${students.data ? ` (${students.data.filter((s) => !s.revoked_at).length})` : ''}`}>
        {students.loading ? <Spinner /> : !students.data?.length ? (
          <p className="muted">No students yet. Everyone who buys this course appears here.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Student</th><th>Joined</th><th>Last opened</th><th>Lessons done</th><th /></tr></thead>
            <tbody>
              {students.data.map((s) => (
                <tr key={s.id} style={s.revoked_at ? { opacity: 0.5 } : undefined}>
                  <td><strong>{s.name || s.email}</strong>{s.name && <div className="small muted">{s.email}</div>}
                    {s.source === 'manual' && <div className="small muted">Added by you</div>}</td>
                  <td>{fmt(s.created_at)}</td>
                  <td>{fmt(s.last_opened_at)}</td>
                  <td>{s.completed}</td>
                  <td className="row-gap" style={{ justifyContent: 'flex-end' }}>
                    {!s.revoked_at && <button type="button" className="link-btn small" onClick={async () => { await emailStudentLink(menuItemId, s.email); toast('Link sent'); }}>Resend link</button>}
                    <button type="button" className="link-btn small" onClick={async () => { await setStudentAccess(s.id, !s.revoked_at); students.reload(); }}>
                      {s.revoked_at ? 'Restore access' : 'Remove access'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
