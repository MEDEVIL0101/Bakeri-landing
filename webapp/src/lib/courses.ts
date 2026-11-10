import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { check, ApiError } from './api';
import { newId, nowISO, up } from './format';
import { blocksForSave, blocksFromRow, type ContentBlock } from './contentBlocks';

/**
 * Courses (migration 20261106000001). A course is a digital listing with
 * is_course; its modules and lessons live in course_modules /
 * course_lessons, each lesson a title + content blocks. Buyers are enrolled
 * at checkout (course_enrollments) and watch in baker/course.html.
 * iOS: CourseService.swift — keep the two in step.
 */
export interface CourseLesson {
  id: string;
  module_id: string;
  title: string;
  sort_order: number;
  is_preview: boolean;
  blocks: ContentBlock[];
}
export interface CourseModule {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
  lessons: CourseLesson[];
}
export interface CourseStudent {
  id: string;
  email: string;
  name: string | null;
  source: 'purchase' | 'manual';
  created_at: string;
  last_opened_at: string | null;
  revoked_at: string | null;
  access_token: string;
  completed: number;
}

export const COURSE_PAGE = 'https://bakeriapp.com/baker/course.html';

export async function loadCourse(menuItemId: string): Promise<CourseModule[]> {
  const [mods, lessons] = await Promise.all([
    supabase.from('course_modules').select('id, title, description, sort_order, created_at').eq('menu_item_id', menuItemId).is('deleted_at', null),
    supabase.from('course_lessons').select('id, module_id, title, sort_order, is_preview, content_blocks, created_at').eq('menu_item_id', menuItemId).is('deleted_at', null),
  ]);
  const byOrder = (a: { sort_order: number; created_at: string }, b: { sort_order: number; created_at: string }) =>
    a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
  const ls = (check(lessons) as any[]).sort(byOrder);
  return (check(mods) as any[]).sort(byOrder).map((m) => ({
    id: m.id, title: m.title, description: m.description, sort_order: m.sort_order,
    lessons: ls.filter((l) => l.module_id === m.id).map((l) => ({
      id: l.id, module_id: l.module_id, title: l.title, sort_order: l.sort_order, is_preview: l.is_preview,
      blocks: blocksFromRow(l.content_blocks),
    })),
  }));
}

export async function addModule(userId: string, menuItemId: string, title: string, sort: number): Promise<CourseModule> {
  const row = { id: newId(), user_id: userId, menu_item_id: menuItemId, title, sort_order: sort };
  check(await supabase.from('course_modules').insert(row));
  return { id: row.id, title, description: null, sort_order: sort, lessons: [] };
}

export async function updateModule(id: string, patch: Partial<Pick<CourseModule, 'title' | 'description' | 'sort_order'>>): Promise<void> {
  check(await supabase.from('course_modules').update({ ...patch, updated_at: nowISO() }).eq('id', id));
}

export async function deleteModule(id: string): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('course_lessons').update({ deleted_at: ts, updated_at: ts }).eq('module_id', id));
  check(await supabase.from('course_modules').update({ deleted_at: ts, updated_at: ts }).eq('id', id));
}

export async function addLesson(userId: string, menuItemId: string, moduleId: string, title: string, sort: number): Promise<CourseLesson> {
  const row = { id: newId(), user_id: userId, menu_item_id: menuItemId, module_id: moduleId, title, sort_order: sort, is_preview: false };
  check(await supabase.from('course_lessons').insert(row));
  return { id: row.id, module_id: moduleId, title, sort_order: sort, is_preview: false, blocks: [] };
}

export async function saveLesson(l: CourseLesson): Promise<void> {
  check(await supabase.from('course_lessons').update({
    title: l.title.trim(), is_preview: l.is_preview, module_id: l.module_id, sort_order: l.sort_order,
    content_blocks: blocksForSave(l.blocks), updated_at: nowISO(),
  }).eq('id', l.id));
}

export async function deleteLesson(id: string): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('course_lessons').update({ deleted_at: ts, updated_at: ts }).eq('id', id));
}

/** Re-numbers sort_order for a reordered list (modules, or lessons in a module). */
export async function reorder(table: 'course_modules' | 'course_lessons', ids: string[]): Promise<void> {
  const ts = nowISO();
  await Promise.all(ids.map((id, i) => supabase.from(table).update({ sort_order: i, updated_at: ts }).eq('id', id)));
}

// ── Students ────────────────────────────────────────────────────────────

export async function listStudents(menuItemId: string): Promise<CourseStudent[]> {
  const rows = check(await supabase.from('course_enrollments')
    .select('id, email, name, source, created_at, last_opened_at, revoked_at, access_token, course_progress(lesson_id)')
    .eq('menu_item_id', menuItemId).order('created_at', { ascending: false })) as any[];
  return rows.map((r) => ({ ...r, completed: (r.course_progress ?? []).length }));
}

/** Gives someone access (a gift, a comp, a bank-transfer buyer) and emails them their link. */
export async function addStudent(userId: string, menuItemId: string, email: string, name: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new ApiError('Enter a valid email address.');
  const { error } = await supabase.from('course_enrollments')
    .insert({ user_id: userId, menu_item_id: menuItemId, email: clean, name: name.trim() || null, source: 'manual' });
  if (error && !/duplicate|unique/i.test(error.message)) throw new ApiError(error.message);
  if (error) check(await supabase.from('course_enrollments').update({ revoked_at: null }).eq('menu_item_id', menuItemId).ilike('email', clean));
  await emailStudentLink(menuItemId, clean);
}

export async function emailStudentLink(menuItemId: string, email: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/functions/v1/course-player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ menu_item_id: menuItemId, email, resend: true }),
  });
}

/** course-player as the shop owner; throws its error message. */
async function ownerAction(menuItemId: string, body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('course-player', { body: { owner: true, menu_item_id: menuItemId, ...body } });
  if (error) {
    const msg = await (error as any).context?.json?.().then((j: any) => j?.error).catch(() => null);
    throw new ApiError(msg || error.message);
  }
  return data;
}

/** Remove / restore someone. Removing a club member also cancels their
 *  subscription (server side), so they stop being charged. */
export async function setStudentAccess(menuItemId: string, id: string, revoked: boolean): Promise<{ cancelled_subscription?: boolean }> {
  return ownerAction(menuItemId, { set_access: id, revoked });
}

/** Before deleting a course/club: cancels every club subscription and removes
 *  everyone. Throws (and nothing should be deleted) if Stripe refused any. */
export async function closeSpace(menuItemId: string): Promise<void> {
  await ownerAction(menuItemId, { close_club: true });
}

// ── Lesson media (private course-media bucket) ──────────────────────────

/** Uploads a lesson video or file to the vendor's private folder, reporting
 *  progress (0–1). Returns the block reference "course-media:<path>", which
 *  course-player turns into a signed link for enrolled students. */
export async function uploadCourseMedia(userId: string, file: File, onProgress: (p: number) => void): Promise<string> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${up(userId)}/${up(newId())}.${ext}`;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Please sign in again.');
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/course-media/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(
      xhr.status === 413 ? 'That file is too big to upload.' : `Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection.'));
    xhr.send(file);
  });
  return `course-media:${path}`;
}

export const isCourseMedia = (url?: string) => !!url && url.startsWith('course-media:');
