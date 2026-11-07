import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, PageHeader, Spinner, Textarea, Toggle, useLoad, useToast } from '../../components/ui';
import { ContentBlocksField } from '../../components/ContentBlocksEditor';
import { supabase } from '../../lib/supabase';
import { uploadContentImage } from '../../lib/contentBlocks';
import { listMenuItems } from '../../lib/menu';
import {
  COURSE_PAGE, addLesson, addModule, addStudent, deleteLesson, deleteModule, emailStudentLink, listStudents, loadCourse,
  reorder, saveLesson, setStudentAccess, updateModule, type CourseLesson, type CourseModule,
} from '../../lib/courses';

/**
 * Course / club builder (2026-11-06, member spaces 2026-11-07): sections and
 * lessons (a club's library) on the left, the selected one on the right —
 * its content opens in a full-screen writing view — plus Members and
 * Community tabs. "Preview as a member" opens the real member page as the
 * owner (course.html?owner=), which always shows everything.
 * iOS: CourseBuilderView.swift.
 */
export function CourseBuilderPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const toast = useToast();
  const items = useLoad(() => (userId ? listMenuItems(userId) : Promise.resolve([])), [userId]);
  const item = items.data?.find((m) => m.id === id);
  const [tab, setTab] = useState<'lessons' | 'students' | 'community'>('lessons');
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

  const club = !!item.is_club;
  const W = club
    ? { section: 'Section', sections: 'sections', lesson: 'Post', lessons: 'posts', people: 'Members', person: 'member', content: 'Library' }
    : { section: 'Module', sections: 'modules', lesson: 'Lesson', lessons: 'lessons', people: 'Students', person: 'student', content: 'Lessons' };
  const ownerURL = `${COURSE_PAGE}?owner=${id}`;
  const header = (
    <PageHeader
      back={<Link to={`/menu/${id}`} className="back-link">{item.name}</Link>}
      title={club ? 'Club' : 'Course'}
      subtitle={`${modules.length} ${modules.length === 1 ? W.section.toLowerCase() : W.sections} · ${lessonCount} ${lessonCount === 1 ? W.lesson.toLowerCase() : W.lessons}${item.is_listed_in_marketplace ? '' : ' · not listed yet'}`}
      actions={
        <div className="row-gap">
          <div className="seg">
            <button className={tab === 'lessons' ? 'active' : ''} onClick={() => setTab('lessons')}>{W.content}</button>
            <button className={tab === 'community' ? 'active' : ''} onClick={() => setTab('community')}>Community</button>
            <button className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>{W.people}</button>
          </div>
          <a className="btn btn-secondary" href={ownerURL} target="_blank" rel="noreferrer"><span>Preview as a {W.person} ↗</span></a>
        </div>
      }
    />
  );
  const steps = [
    { done: modules.length > 0 && lessonCount > 0, label: `Add your first ${W.lesson.toLowerCase()}`, hint: club ? 'Resources members get: guides, videos, recipes, files.' : 'A module is a section; lessons go inside it.' },
    { done: !!item.is_listed_in_marketplace, label: 'List it on your storefront', hint: 'It gets its own card on your page, with the join/buy button.', to: `/menu/${id}` },
    { done: false, label: `Preview it as a ${W.person}`, hint: 'See exactly what buyers get, before anyone has paid.', href: ownerURL },
  ];
  const showGuide = lessonCount < 2 || !item.is_listed_in_marketplace;

  return (
    <div className="page">
      {header}
      {error && <ErrorBanner message={error} />}
      {showGuide && tab === 'lessons' && (
        <Card title={`Set up your ${club ? 'club' : 'course'}`}>
          <ol className="setup-steps">
            {steps.map((s) => (
              <li key={s.label} className={s.done ? 'done' : ''}>
                <span className="setup-dot">{s.done ? '✓' : ''}</span>
                <span className="grow"><strong>{s.label}</strong><span className="small muted">{s.hint}</span></span>
                {s.to && !s.done && <Link className="link-btn small" to={s.to}>Open</Link>}
                {s.href && <a className="link-btn small" href={s.href} target="_blank" rel="noreferrer">Open ↗</a>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {tab === 'community' ? <CommunitySettings item={item} ownerURL={ownerURL} club={club} onSaved={() => items.reload()} /> :
       tab === 'students' ? <Students menuItemId={id} userId={userId!} club={club} /> : (
        <div className="course-grid">
          <div className="course-outline">
            {modules.length === 0 && (
              <EmptyState title={`Start with a ${W.section.toLowerCase()}`} body={club
                ? 'A section groups your library — e.g. “Holiday recipes” or “Monthly live replays”. Add posts inside it.'
                : 'A module is a section of your course — e.g. “Tempering basics”. Add lessons inside it.'} />
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
                <button type="button" className="cb-add-btn" onClick={() => newLesson(m)}>+ {W.lesson}</button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={newModule}>+ Add {W.section.toLowerCase()}</Button>
          </div>

          <div className="course-lesson">
            {!draft ? (
              <Card><p className="muted">Pick a {W.lesson.toLowerCase()} on the left, or add one.</p></Card>
            ) : (
              <Card title={W.lesson} actions={
                <div className="row-gap">
                  {dirty && <span className="small muted">Unsaved changes</span>}
                  <Button type="button" onClick={save} loading={saving} disabled={!dirty}>Save</Button>
                </div>
              }>
                <Field label="Title"><Input value={draft.title} onChange={(e) => setD({ title: e.target.value })} placeholder={club ? 'December recipe pack' : 'Tempering chocolate three easy ways'} /></Field>
                <Toggle checked={draft.is_preview} onChange={(v) => setD({ is_preview: v })} label="Free preview"
                  hint={`Anyone can open this from your sales page — a taster before they ${club ? 'join' : 'buy'}.`} />
                <ContentBlocksField userId={userId!} blocks={draft.blocks} course title={draft.title || `Untitled ${W.lesson.toLowerCase()}`}
                  heading={<input className="cb-fs-heading" value={draft.title} placeholder="Title" onChange={(e) => setD({ title: e.target.value })} />}
                  actions={<>{dirty && <span className="small muted">Unsaved</span>}<Button type="button" onClick={save} loading={saving} disabled={!dirty}>Save</Button></>}
                  onChange={(fn) => { setDraft((d) => (d ? { ...d, blocks: fn(d.blocks) } : d)); setDirty(true); }} />
                <div className="row-gap" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                  <button type="button" className="link-btn small" onClick={() => setConfirm({
                    title: `Delete “${draft.title}”?`, body: 'It will be removed for every student.',
                    run: async () => {
                      await deleteLesson(draft.id);
                      setModules((ms) => (ms ?? []).map((m) => ({ ...m, lessons: m.lessons.filter((x) => x.id !== draft.id) })));
                      setSelected(null); setDraft(null); setDirty(false);
                    },
                  })}>Delete {W.lesson.toLowerCase()}</button>
                  <Button type="button" onClick={save} loading={saving} disabled={!dirty}>Save</Button>
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

function CommunitySettings({ item, ownerURL, club, onSaved }: { item: any; ownerURL: string; club: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(item.channel_enabled !== false);
  const [open, setOpen] = useState(item.members_can_post !== false);
  async function save(patch: Record<string, boolean>) {
    const { error } = await supabase.from('menu_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', item.id);
    if (error) { toast(error.message); return; }
    toast('Saved'); onSaved();
  }
  const who = club ? 'members' : 'students';
  return (
    <div className="stack-lg">
      <Card title="Community" actions={<a className="btn btn-primary" href={`${ownerURL}#community`} target="_blank" rel="noreferrer"><span>Open the community ↗</span></a>}>
        <p className="muted" style={{ marginTop: 0 }}>
          A chat for everyone in this {club ? 'club' : 'course'}, like a Slack channel: {who} post, reply in threads and react.
          You post as your shop, pin important messages to the top, and remove anything that doesn’t belong.
          Tick “Post as an Update” and your post is also emailed to every {club ? 'member' : 'student'}.
        </p>
        <Toggle checked={on} onChange={(v) => { setOn(v); save({ channel_enabled: v }); }} label="Community on"
          hint={on ? `${club ? 'Members' : 'Students'} see a ${club ? 'Community' : 'Discussion'} tab.` : 'Hidden from members. You can still open it.'} />
        {on && (
          <Toggle checked={open} onChange={(v) => { setOpen(v); save({ members_can_post: v }); }} label={`${club ? 'Members' : 'Students'} can post`}
            hint={open ? 'Everyone can start conversations and reply.' : 'Announcements only: just you post; everyone can react.'} />
        )}
      </Card>
      <SpaceDesignCard item={item} club={club} ownerURL={ownerURL} onSaved={onSaved} />
    </div>
  );
}

/** menu_items.space_design — the member page's look and welcome (course.html). */
interface SpaceDesign { style?: string; cover_url?: string; accent?: string; background?: string; community_name?: string; welcome_title?: string; welcome_body?: string; rules?: string }

function SpaceDesignCard({ item, club, ownerURL, onSaved }: { item: any; club: boolean; ownerURL: string; onSaved: () => void }) {
  const toast = useToast();
  const userId = useUserId();
  const [d, setD] = useState<SpaceDesign>(item.space_design ?? {});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const upd = (p: Partial<SpaceDesign>) => { setD((x) => ({ ...x, ...p })); setDirty(true); };
  async function save() {
    setBusy(true);
    const clean = Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === 'string' && v.trim())) as SpaceDesign;
    const { error } = await supabase.from('menu_items')
      .update({ space_design: Object.keys(clean).length ? clean : null, updated_at: new Date().toISOString() }).eq('id', item.id);
    setBusy(false);
    if (error) { toast(error.message); return; }
    setDirty(false); toast('Saved — open the preview to see it'); onSaved();
  }
  async function pickCover(file: File | undefined) {
    if (!file || !userId) return;
    setUploading(true);
    try { upd({ cover_url: await uploadContentImage(userId, file) }); } catch (e: any) { toast(e.message ?? 'Upload failed'); }
    setUploading(false);
  }
  const hex = (v?: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : '#1a130f');
  return (
    <Card title="Design" actions={<div className="row-gap">
      <a className="btn btn-ghost" href={`${ownerURL}#community`} target="_blank" rel="noreferrer">Preview ↗</a>
      <Button type="button" onClick={save} loading={busy} disabled={!dirty}>Save</Button></div>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Make the {club ? 'club' : 'course'} feel like yours. The cover, welcome and guidelines sit at the top of the
        {club ? ' community' : ' discussion'}; your colours run through the whole member page.
      </p>
      <Field label="Cover photo">
        <div className="row-gap">
          {d.cover_url && <img src={d.cover_url} alt="" style={{ width: 180, aspectRatio: '3 / 1', objectFit: 'cover', borderRadius: 10 }} />}
          <label className="btn btn-secondary">
            <input type="file" accept="image/*" hidden onChange={(e) => pickCover(e.target.files?.[0])} />
            <span>{uploading ? 'Uploading…' : d.cover_url ? 'Replace' : 'Add a cover photo'}</span>
          </label>
          {d.cover_url && <button type="button" className="link-btn small" onClick={() => upd({ cover_url: '' })}>Remove</button>}
        </div>
      </Field>
      <Toggle checked={d.style !== 'custom'} onChange={(v) => upd({ style: v ? '' : 'custom' })} label="Use my website’s style"
        hint={d.style !== 'custom' ? 'Your storefront’s colours and title font. Changes to your site show here too.' : 'This page has its own colours.'} />
      <div className="grid-2">
        <Field label={`Name for the ${club ? 'community' : 'discussion'} tab`}>
          <Input value={d.community_name ?? ''} placeholder={club ? 'Community' : 'Discussion'} onChange={(e) => upd({ community_name: e.target.value })} />
        </Field>
        {d.style === 'custom' && <div className="grid-2">
          <Field label="Accent colour" hint={d.accent ? undefined : 'Your storefront’s'}>
            <div className="row-gap"><input type="color" value={hex(d.accent)} onChange={(e) => upd({ accent: e.target.value })} />
              {d.accent && <button type="button" className="link-btn small" onClick={() => upd({ accent: '' })}>Reset</button>}</div>
          </Field>
          <Field label="Background" hint={d.background ? undefined : 'Cream'}>
            <div className="row-gap"><input type="color" value={d.background && /^#[0-9a-f]{6}$/i.test(d.background) ? d.background : '#faf6ee'} onChange={(e) => upd({ background: e.target.value })} />
              {d.background && <button type="button" className="link-btn small" onClick={() => upd({ background: '' })}>Reset</button>}</div>
          </Field>
        </div>}
      </div>
      <Field label="Welcome title"><Input value={d.welcome_title ?? ''} placeholder={`Welcome to ${item.name}!`} onChange={(e) => upd({ welcome_title: e.target.value })} /></Field>
      <Field label="Welcome message"><Textarea rows={4} value={d.welcome_body ?? ''}
        placeholder={club ? 'Say hi below and tell us what you’re baking this week. New recipes drop on the 1st of every month.' : 'Start with lesson 1, and post your questions here — I answer every day.'}
        onChange={(e) => upd({ welcome_body: e.target.value })} /></Field>
      <Field label="Community guidelines (optional)"><Textarea rows={3} value={d.rules ?? ''}
        placeholder={'Be kind. Share your bakes. No selling in the chat.'} onChange={(e) => upd({ rules: e.target.value })} /></Field>
    </Card>
  );
}

function Students({ menuItemId, userId, club }: { menuItemId: string; userId: string; club: boolean }) {
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
      <Card title={club ? 'Add a member' : 'Add a student'} actions={<span className="small muted">For gifts, comps, or someone who paid another way</span>}>
        <div className="grid-2">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@email.com" /></Field>
          <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        {err && <p className="small warn-text">{err}</p>}
        <Button type="button" onClick={add} loading={busy} disabled={!email.trim()}>Give access & email their link</Button>
      </Card>
      <Card title={`${club ? 'Members' : 'Students'}${students.data ? ` (${students.data.filter((s) => !s.revoked_at).length})` : ''}`}>
        {students.loading ? <Spinner /> : !students.data?.length ? (
          <p className="muted">{club ? 'No members yet. Everyone who joins appears here.' : 'No students yet. Everyone who buys this course appears here.'}</p>
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
