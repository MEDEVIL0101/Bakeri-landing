import { useState } from 'react';
import { Button, Card, ErrorBanner, Modal, useLoad } from '../../components/ui';
import {
  attachPackaging, kindLabel, lineCost, listOrderPackaging, listPackaging, setPackagingQuantity, type PackagingItem,
} from '../../lib/packaging';
import { formatMoney } from '../../lib/format';
import { PackagingModal } from '../kitchen/PackagingPage';

/** Mirrors iOS OrderPackagingSection: packaging attached to one order, vendor-only. */
export function OrderPackagingCard({ userId, orderId }: { userId: string; orderId: string }) {
  const lines = useLoad(() => listOrderPackaging(userId, orderId), [userId, orderId]);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = (lines.data ?? []).reduce((t, l) => t + lineCost(l), 0);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.message); }
    lines.reload();
  }

  return (
    <Card title="Packaging" actions={<span className="small muted">Only you see this</span>}>
      {lines.error && <ErrorBanner message={lines.error} onRetry={lines.reload} />}
      {(lines.data ?? []).map((l) => (
        <div key={l.id} className="packaging-line">
          <div className="grow">
            <div>{l.name}</div>
            <div className="small muted">{l.kind_label} · {formatMoney(Number(l.unit_cost))} each</div>
          </div>
          <div className="qty-stepper">
            <button className="icon-btn sm" aria-label={l.quantity === 1 ? 'Remove' : 'One fewer'} onClick={() => run(() => setPackagingQuantity(l, l.quantity - 1))}>−</button>
            <span className="num">×{l.quantity}</span>
            <button className="icon-btn sm" aria-label="One more" onClick={() => run(() => setPackagingQuantity(l, l.quantity + 1))}>+</button>
          </div>
        </div>
      ))}
      {total > 0 && <p className="small"><strong>Packaging cost: {formatMoney(total)}</strong> — counted in Finances.</p>}
      <Button variant="secondary" data-icon="plus" onClick={() => setPicking(true)}>
        {(lines.data ?? []).length ? 'Add more packaging' : 'Add packaging'}
      </Button>
      {err && <ErrorBanner message={err} />}
      {picking && (
        <PackagingPicker userId={userId} onClose={() => setPicking(false)}
          onPick={(item) => { setPicking(false); run(() => attachPackaging(userId, orderId, item, lines.data ?? [])); }} />
      )}
    </Card>
  );
}

function PackagingPicker({ userId, onClose, onPick }: { userId: string; onClose: () => void; onPick: (p: PackagingItem) => void }) {
  const items = useLoad(() => listPackaging(userId), [userId]);
  const [adding, setAdding] = useState(false);
  if (adding) return <PackagingModal userId={userId} onClose={() => setAdding(false)} onSaved={onPick} />;
  return (
    <Modal title="Add packaging" onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <Button variant="secondary" data-icon="plus" onClick={() => setAdding(true)}>New packaging</Button>
      {items.error && <ErrorBanner message={items.error} onRetry={items.reload} />}
      {!!items.data?.length && (
        <div className="stack">
          {items.data.map((p) => (
            <button key={p.id} type="button" className="packaging-pick" onClick={() => onPick(p)}>
              <span className="grow">{p.name} <span className="small muted">· {kindLabel(p)}</span></span>
              <span className="num">{formatMoney(Number(p.price))}</span>
            </button>
          ))}
        </div>
      )}
      {items.data && !items.data.length && <p className="small muted">Your packaging list is empty — add your first item above.</p>}
    </Modal>
  );
}
