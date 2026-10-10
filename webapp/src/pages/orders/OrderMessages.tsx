import { useEffect, useRef, useState } from 'react';
import { Button, Card, ErrorBanner, Spinner, Textarea } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { check } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Order } from '../../lib/types';

interface Msg { id: string; sender_profile_id: string; message: string; created_at: string }

/**
 * In-order chat with a customer who ordered with a Bakeri account
 * (iOS OrderMessageThread). Guest orders have no thread — their email and
 * phone are shown on the Customer card instead.
 */
export function OrderMessages({ order, userId }: { order: Order; userId: string }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const closed = order.marketplace_status === 'declined' || order.marketplace_status === 'cancelled';

  async function load() {
    try {
      setMsgs(check(await supabase.from('order_messages').select('id, sender_profile_id, message, created_at').eq('order_id', order.id).order('created_at')) as Msg[]);
    } catch (e: any) { setErr(e.message); }
  }

  useEffect(() => {
    load();
    const ch = supabase.channel(`order-messages-${order.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${order.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs?.length]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true); setErr(null);
    try {
      check(await supabase.from('order_messages').insert({ order_id: order.id, sender_profile_id: userId, message: text }));
      setDraft('');
      await load();
    } catch (e: any) { setErr(`Couldn’t send: ${e.message}`); }
    setBusy(false);
  }

  const name = order.buyer_display_name || 'Customer';
  return (
    <Card title="Messages">
      {!msgs ? <Spinner /> : !msgs.length ? <p className="small muted">No messages yet. Send {name} a note about their order.</p> : (
        <div className="thread">
          {msgs.map((m) => {
            const me = m.sender_profile_id.toLowerCase() === userId.toLowerCase();
            return (
              <div key={m.id} className={`bubble ${me ? 'me' : ''}`}>
                <p className="prewrap">{m.message}</p>
                <span className="bubble-meta">{me ? 'You' : name} · {formatDateTime(m.created_at)}</span>
              </div>
            );
          })}
          <div ref={end} />
        </div>
      )}
      {closed ? <p className="small muted">This order is closed, so messaging is off.</p> : (
        <div className="composer">
          <Textarea rows={2} value={draft} placeholder={`Message ${name}…`} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
          <Button onClick={send} loading={busy} disabled={!draft.trim()}>Send</Button>
        </div>
      )}
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}
