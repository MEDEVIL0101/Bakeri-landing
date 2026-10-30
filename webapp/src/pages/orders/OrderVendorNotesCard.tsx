import { useEffect, useRef, useState } from 'react';
import { Card, ErrorBanner, Textarea, useLoad } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { check } from '../../lib/api';

/**
 * Mirrors iOS MarketplaceOrderSheet.vendorNotesCard: the vendor's own notes on
 * a storefront order. Kept in order_vendor_notes, not orders.notes — on a
 * storefront order that column is the customer's note, and a buyer with an
 * account can read their own order row. Saves a second after typing stops,
 * and on blur.
 */
export function OrderVendorNotesCard({ userId, orderId }: { userId: string; orderId: string }) {
  const loaded = useLoad(async () => {
    const rows = check(await supabase.from('order_vendor_notes').select('notes').eq('order_id', orderId).limit(1)) as { notes: string }[];
    return rows[0]?.notes ?? '';
  }, [orderId]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const saved = useRef('');
  const timer = useRef<number>();

  useEffect(() => {
    if (loaded.data === undefined) return;
    saved.current = loaded.data;
    setText(loaded.data);
  }, [loaded.data]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function save(value: string) {
    window.clearTimeout(timer.current);
    if (value === saved.current) return;
    setStatus('saving');
    setErr(null);
    try {
      check(await supabase.from('order_vendor_notes')
        .upsert({ order_id: orderId, user_id: userId, notes: value, updated_at: new Date().toISOString() }, { onConflict: 'order_id' }));
      saved.current = value;
      setStatus('saved');
    } catch (e: any) {
      setStatus('idle');
      setErr(`Your note couldn't be saved: ${e.message}`);
    }
  }

  function onChange(value: string) {
    setText(value);
    setStatus('idle');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(value), 1000);
  }

  return (
    <Card title="Your notes" actions={<span className="small muted">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Only you see this'}</span>}>
      {loaded.error && <ErrorBanner message={loaded.error} onRetry={loaded.reload} />}
      <Textarea value={text} placeholder="Add a note about this order" disabled={loaded.data === undefined}
        onChange={(e) => onChange(e.target.value)} onBlur={() => save(text)} aria-label="Your notes" />
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}
