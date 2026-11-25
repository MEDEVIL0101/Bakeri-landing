import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBanner, Textarea, useLoad } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { listOrderTexts, loadTextingOn, markTextsRead, sendOrderText, textError, type OrderText } from '../../lib/texts';
import type { Order } from '../../lib/types';

/** Two-way texting with the customer on this order: texts go from the Bakerï
 *  number as "<Shop>: …", and their replies land here. Refreshes every 15s. */
export function OrderTextsCard({ order }: { order: Order }) {
  const texts = useLoad(() => listOrderTexts(order.id), [order.id]);
  const on = useLoad(() => loadTextingOn(order.user_id), [order.user_id]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [extra, setExtra] = useState<OrderText[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => { texts.reload(); setExtra([]); }, 15000);
    return () => clearInterval(t);
  }, [texts]);
  const all = [...(texts.data ?? []), ...extra.filter((x) => !(texts.data ?? []).some((y) => y.id === x.id))];
  useEffect(() => {
    const unread = all.filter((t) => t.direction === 'in' && !t.read_at).map((t) => t.id);
    if (unread.length) markTextsRead(unread).catch(() => {});
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order.customer_phone?.trim()) return null;

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setBusy(true); setErr(null);
    try {
      const t = await sendOrderText(order.id, message);
      setExtra((x) => [...x, t]);
      setDraft('');
    } catch (e: any) {
      setErr(textError(e?.message || ''));
    } finally { setBusy(false); }
  }

  return (
    <Card title="Texts" actions={<span className="small muted">{order.customer_phone}</span>}>
      {texts.error && <ErrorBanner message={texts.error} onRetry={texts.reload} />}
      {on.data === false && (
        <p className="small muted">Texting is off. <Link to="/shop-settings">Turn it on in Shop settings</Link> to text {order.customer_name || 'this customer'} about their order.</p>
      )}
      {all.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', marginBottom: 12 }}>
          {all.map((t) => (
            <div key={t.id} style={{ alignSelf: t.direction === 'out' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <div style={{ padding: '9px 13px', borderRadius: 16, whiteSpace: 'pre-wrap',
                background: t.direction === 'out' ? 'var(--ink, #201e1d)' : 'var(--surface-2, #f1eeea)',
                color: t.direction === 'out' ? '#fff' : 'inherit' }}>{t.body}</div>
              <div className="small muted" style={{ textAlign: t.direction === 'out' ? 'right' : 'left', marginTop: 2 }}>
                {formatDateTime(t.created_at)}{t.direction === 'out' && t.status === 'failed' ? ' · not delivered' : ''}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {on.data !== false && (
        <>
          <Textarea rows={2} placeholder={`Text ${order.customer_name || 'your customer'}…`} value={draft} maxLength={600}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Button type="button" onClick={send} disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send text'}</Button>
            <span className="small muted">Sent from the Bakerï number as “{'{'}your shop{'}'}: …”. Replies show up here.</span>
          </div>
        </>
      )}
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}
