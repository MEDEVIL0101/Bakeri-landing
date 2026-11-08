import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, ConfirmModal, ErrorBanner, PageHeader, Spinner, useLoad } from '../../components/ui';
import { listMenuItems } from '../../lib/menu';
import { COURSE_PAGE } from '../../lib/courses';
import {
  COMMUNITY_EMOJI, communityFeed, communityPin, communityPost, communityReact, communityRemove, communityThread, markCommunitySeen,
  type CommunityMessage,
} from '../../lib/community';

/**
 * Manage one community as the shop (Courses / Clubs → Community): the conversation
 * members see, with the shop's tools — post, post an Update (emailed to
 * members), threads, reactions, pin, remove. Refreshes every 5 seconds.
 * iOS: CommunityChannelView.
 */
export function CommunityManagePage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const items = useLoad(() => (userId ? listMenuItems(userId) : Promise.resolve([])), [userId]);
  const item = items.data?.find((m) => m.id === id);
  const club = !!item?.is_club;
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [pinned, setPinned] = useState<CommunityMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [threadMsgs, setThreadMsgs] = useState<CommunityMessage[]>([]);
  const [removing, setRemoving] = useState<CommunityMessage | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const f = await communityFeed(id);
      setMessages((prev) => {
        const older = prev.filter((m) => !f.messages.some((x) => x.id === m.id) && m.created_at < (f.messages[0]?.created_at ?? ''));
        return [...older, ...f.messages];
      });
      setPinned(f.pinned);
      setMore((m) => (messages.length > f.messages.length ? m : f.more));
      setError(null);
      markCommunitySeen(id);
    } catch (e: any) {
      if (!loaded) setError(e.message ?? 'Couldn’t load the conversation.');
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadThread = useCallback(async (parent: string) => {
    try { setThreadMsgs(await communityThread(id, parent)); } catch { /* keep what's shown */ }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) { load(); if (thread) loadThread(thread); } }, 5000);
    return () => clearInterval(t);
  }, [load, loadThread, thread]);

  // Follow new messages when already at the bottom.
  useEffect(() => {
    const el = feedRef.current, last = messages[messages.length - 1]?.id ?? null;
    if (!el || last === lastId.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom || lastId.current === null) el.scrollTop = el.scrollHeight;
    lastId.current = last;
  }, [messages]);

  const refresh = () => { load(); if (thread) loadThread(thread); };
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); refresh(); } catch (e: any) { setError(e.message); } };

  async function older() {
    if (!messages[0]) return;
    const f = await communityFeed(id, messages[0].created_at);
    setMessages((m) => [...f.messages, ...m]); setMore(f.more);
  }

  if (items.loading) return <div className="page"><Spinner /></div>;
  if (!item) return <div className="page"><ErrorBanner message="This community couldn’t be found." /></div>;

  const row = (m: CommunityMessage, inThread: boolean) => (
    <MessageRow key={m.id} m={m} inThread={inThread}
      onReact={(e) => act(() => communityReact(id, m.id, e))}
      onThread={() => { setThread(m.id); loadThread(m.id); }}
      onPin={() => act(() => communityPin(id, m.id, !m.is_pinned))}
      onRemove={() => setRemoving(m)} />
  );

  let lastDay = '';
  return (
    <div className="page community-page">
      <PageHeader back={<Link to={club ? '/clubs' : '/courses'} className="back-link">{club ? 'Clubs' : 'Courses'}</Link>} title={item.name}
        subtitle={`${club ? 'Club' : 'Course'} community · you post as your shop`}
        actions={<div className="row-gap">
          <Link className="btn btn-secondary" to={`/communities/${id}/design`}><span>Design</span></Link>
          <a className="btn btn-ghost" href={`${COURSE_PAGE}?owner=${id}#community`} target="_blank" rel="noreferrer">See it as members do ↗</a>
        </div>} />
      {error && <ErrorBanner message={error} />}
      <div className={`cm-chat ${thread ? 'with-thread' : ''}`}>
        <section className="cm-main">
          {pinned.length > 0 && (
            <details className="cm-pins" open={pinned.length <= 2}>
              <summary>📌 {pinned.length} pinned</summary>
              {pinned.map((m) => row(m, true))}
            </details>
          )}
          <div className="cm-feed" ref={feedRef}>
            {more && <button type="button" className="btn btn-secondary btn-sm cm-older" onClick={older}>Load earlier messages</button>}
            {loaded && !messages.length && (
              <div className="cm-empty"><strong>Say hello 👋</strong>
                <span>Welcome your {club ? 'members' : 'students'}, share what’s coming, or pin the house rules.</span></div>
            )}
            {messages.map((m) => {
              const day = new Date(m.created_at).toDateString();
              const divider = day !== lastDay ? <div key={`d-${m.id}`} className="cm-day">{dayLabel(m.created_at)}</div> : null;
              lastDay = day;
              return [divider, row(m, false)];
            })}
          </div>
          <Composer placeholder={`Message ${item.name}`} allowUpdate club={club}
            onSend={async (text, update) => { await communityPost(id, text, { update }); refresh(); }} />
        </section>
        {thread && (
          <aside className="cm-thread">
            <div className="cm-thread-head"><strong>Thread</strong><button type="button" className="link-btn" onClick={() => setThread(null)}>Close ✕</button></div>
            <div className="cm-feed">{threadMsgs.map((m, i) => <div key={m.id} className={i === 0 ? 'cm-thread-first' : ''}>{row(m, true)}</div>)}</div>
            <Composer placeholder="Reply…" club={club} onSend={async (text) => { await communityPost(id, text, { parent: thread }); refresh(); }} />
          </aside>
        )}
      </div>
      {removing && (
        <ConfirmModal title="Remove this message?" body="It’s removed for everyone." confirmLabel="Remove" danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => { const m = removing; setRemoving(null); if (m.id === thread) setThread(null); await act(() => communityRemove(id, m.id)); }} />
      )}
    </div>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const PALETTE = ['#B24FE8', '#00A5BA', '#E91E63', '#3F9F6B', '#E07B2E', '#5C6BC0', '#8D6E63'];

function MessageRow({ m, inThread, onReact, onThread, onPin, onRemove }: {
  m: CommunityMessage; inThread: boolean; onReact: (e: string) => void; onThread: () => void; onPin: () => void; onRemove: () => void;
}) {
  let h = 0; for (const ch of m.author) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const time = new Date(m.created_at);
  return (
    <div className={`cm-msg ${m.is_update ? 'update' : ''}`} tabIndex={0}>
      <div className="cm-av" style={{ background: m.from_shop ? 'var(--ink)' : PALETTE[h % PALETTE.length] }}>
        {m.from_shop ? '🏪' : (m.author.trim()[0] ?? '?').toUpperCase()}
      </div>
      <div className="cm-body">
        <div className="cm-head">
          <strong>{m.author}</strong>
          {m.from_shop && <span className="cm-tag">Shop</span>}
          {m.is_update && <span className="cm-tag upd">Update</span>}
          <span className="small muted">{time.toDateString() === new Date().toDateString()
            ? time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            : time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{m.edited_at ? ' · edited' : ''}</span>
          {m.is_pinned && !inThread && <span className="small muted">📌 Pinned</span>}
        </div>
        {m.deleted ? <div className="cm-removed">This message was removed.</div> : <div className="cm-text">{m.body}</div>}
        {m.reactions.length > 0 && (
          <div className="cm-reacts">
            {m.reactions.map((r) => <button type="button" key={r.emoji} className={`cm-react ${r.me ? 'me' : ''}`} onClick={() => onReact(r.emoji)}>{r.emoji} {r.count}</button>)}
          </div>
        )}
        {!inThread && m.reply_count > 0 && (
          <button type="button" className="cm-replies" onClick={onThread}>{m.reply_count} repl{m.reply_count === 1 ? 'y' : 'ies'} →</button>
        )}
      </div>
      {!m.deleted && (
        <div className="cm-tools">
          {COMMUNITY_EMOJI.map((e) => <button type="button" key={e} title="React" onClick={() => onReact(e)}>{e}</button>)}
          {!inThread && !m.parent_id && <button type="button" title="Reply in thread" onClick={onThread}>💬</button>}
          {!m.parent_id && <button type="button" title={m.is_pinned ? 'Unpin' : 'Pin to the top'} onClick={onPin}>📌</button>}
          <button type="button" title="Remove" onClick={onRemove}>🗑</button>
        </div>
      )}
    </div>
  );
}

function Composer({ placeholder, allowUpdate, club, onSend }: {
  placeholder: string; allowUpdate?: boolean; club: boolean; onSend: (text: string, update: boolean) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    const t = text.trim();
    if (!t) return;
    if (update && !window.confirm(`Post this as an Update? It’s also emailed to every ${club ? 'member' : 'student'}.`)) return;
    setBusy(true); setErr(null);
    try { await onSend(t, update); setText(''); setUpdate(false); } catch (e: any) { setErr(e.message ?? 'Couldn’t send that.'); }
    setBusy(false);
  }
  return (
    <div className="cm-composer">
      <textarea className="input" rows={2} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <div className="row-gap" style={{ justifyContent: 'space-between' }}>
        {allowUpdate ? (
          <label className="small"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} /> Post as an Update <span className="muted">(also emails every {club ? 'member' : 'student'})</span></label>
        ) : <span className="small muted">Enter to send · Shift+Enter for a new line</span>}
        <Button type="button" onClick={send} loading={busy} disabled={!text.trim()}>Send</Button>
      </div>
      {err && <p className="small warn-text">{err}</p>}
    </div>
  );
}
