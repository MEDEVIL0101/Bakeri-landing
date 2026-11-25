import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBanner, Textarea, useLoad } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { listOrderTexts, loadTextingOn, sendOrderText, textError, type OrderText } from '../../lib/texts';
import type { Order } from '../../lib/types';

/** Text the customer about this order. Texts go from the Bakerï number (which
 *  can't take replies) as "<Shop>: …", ending with how to reach you. */
export function OrderTextsCard({ order }: { order: Order }) {
  const texts = useLoad(() => listOrderTexts(order.id), [order.id]);
  const on = useLoad(() => loadTextingOn(order.user_id), [order.user_id]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [extra, setExtra] = useState<OrderText[]>([]);
  if (!order.customer_phone?.trim()) return null;
  const sent = [...(texts.data ?? []), ...extra].filter((t) => t.direction === 'out');

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setBusy(true); setErr(null);
    try { const t = await sendOrderText(order.id, message); setExtra((x) => [...x, t]); setDraft(''); }
    catch (e: any) { setErr(textError(e?.message || '')); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Text the customer" actions={<span className="small muted">{order.customer_phone}</span>}>
      {texts.error && <ErrorBanner message={texts.error} onRetry={texts.reload} />}
      {on.data === false && (
        <p className="small muted">Texting is off. <Link to="/shop-settings">Turn it on in Shop settings</Link> to text {order.customer_name || 'this customer'} about their order.</p>
      )}
      {sent.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {sent.map((t) => (
            <div key={t.id} style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
              <div style={{ padding: '9px 13px', borderRadius: 16, whiteSpace: 'pre-wrap', background: 'var(--ink, #201e1d)', color: '#fff' }}>{t.body}</div>
              <div className="small muted" style={{ textAlign: 'right', marginTop: 2 }}>
                Sent {formatDateTime(t.created_at)}{t.status === 'failed' || t.status === 'undelivered' ? ' · not delivered' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {on.data !== false && (
        <>
          <Textarea rows={2} placeholder={`Text ${order.customer_name || 'your customer'}…`} value={draft} maxLength={600}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Button type="button" onClick={send} disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send text'}</Button>
            <span className="small muted">Sent as “your shop: …” and ends with how to reach you. Replies don’t come back here.</span>
          </div>
        </>
      )}
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}
