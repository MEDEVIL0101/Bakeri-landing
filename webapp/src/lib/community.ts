import { supabase } from './supabase';

/**
 * A course/club's community, managed by its shop — the member-space function
 * called as the owner (supabase.functions.invoke sends the vendor's token),
 * the same channel members see on baker/course.html. iOS: MemberCommunityService.
 */
export interface CommunityReaction { emoji: string; count: number; me: boolean }
export interface CommunityMessage {
  id: string; parent_id: string | null; body: string; author: string; from_shop: boolean; mine: boolean;
  is_pinned: boolean; is_update: boolean; reply_count: number; created_at: string; edited_at: string | null;
  deleted: boolean; reactions: CommunityReaction[];
}
export interface CommunityFeed { messages: CommunityMessage[]; pinned: CommunityMessage[]; more: boolean }

export const COMMUNITY_EMOJI = ['👍', '❤️', '😂', '🎉', '🙌', '😮'];

async function call<T>(menuItemId: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('member-space', { body: { owner: true, menu_item_id: menuItemId, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  return data as T;
}

export const communityFeed = (id: string, before?: string) => call<CommunityFeed>(id, { channel: 'list', before });
export const communityThread = (id: string, parent: string) => call<CommunityFeed>(id, { channel: 'list', thread: parent }).then((f) => f.messages);
export const communityPost = (id: string, body: string, opts: { parent?: string; update?: boolean } = {}) =>
  call(id, { channel: 'post', body, parent_id: opts.parent, is_update: opts.update || undefined });
export const communityReact = (id: string, message: string, emoji: string) => call(id, { channel: 'react', message_id: message, emoji });
export const communityPin = (id: string, message: string, pinned: boolean) => call(id, { channel: 'pin', message_id: message, pinned });
export const communityRemove = (id: string, message: string) => call(id, { channel: 'delete', message_id: message });

// New since the shop last looked (kept in this browser).
const seenKey = (id: string) => `bakeri.community.seen.${id.toLowerCase()}`;
export function markCommunitySeen(id: string) { try { localStorage.setItem(seenKey(id), new Date().toISOString()); } catch { /* ignore */ } }
export async function communityNewCount(id: string): Promise<number> {
  let since = '1970-01-01T00:00:00Z';
  try { since = localStorage.getItem(seenKey(id)) ?? since; } catch { /* ignore */ }
  const { count } = await supabase.from('channel_messages').select('id', { count: 'exact', head: true })
    .eq('menu_item_id', id).not('enrollment_id', 'is', null).is('deleted_at', null).gt('created_at', since);
  return count ?? 0;
}
export async function communityMemberCount(id: string): Promise<number> {
  const { count } = await supabase.from('course_enrollments').select('id', { count: 'exact', head: true }).eq('menu_item_id', id).is('revoked_at', null);
  return count ?? 0;
}

/** What the Communities page shows about one community. */
export interface CommunityStats { members: number; fresh: number; week: number; last: { author: string; body: string; at: string; fromShop: boolean } | null }

export async function communityStats(id: string): Promise<CommunityStats> {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [members, fresh, week, last] = await Promise.all([
    communityMemberCount(id),
    communityNewCount(id),
    supabase.from('channel_messages').select('id', { count: 'exact', head: true }).eq('menu_item_id', id).is('deleted_at', null).gt('created_at', weekAgo)
      .then((r) => r.count ?? 0),
    supabase.from('channel_messages').select('author_name, body, created_at, enrollment_id').eq('menu_item_id', id).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then((r) => (r.data ? { author: r.data.author_name, body: r.data.body, at: r.data.created_at, fromShop: !r.data.enrollment_id } : null)),
  ]);
  return { members, fresh, week, last };
}
