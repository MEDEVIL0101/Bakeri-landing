import { useState } from 'react';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import { PACKAGING_KINDS, deletePackaging, kindLabel, listPackaging, savePackaging, type PackagingItem, type PackagingKind } from '../../lib/packaging';
import { formatMoney, parseNumber } from '../../lib/format';

/** Mirrors iOS PackagingView: boxes, bags and anything else that goes out with an order. */
export function PackagingPage() {
  const userId = useUserId();
  const toast = useToast();
  const items = useLoad(() => listPackaging(userId), [userId]);
  const [editing, setEditing] = useState<PackagingItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PackagingItem | null>(null);

  if (items.loading && !items.data) return <div className="page"><Spinner /></div>;
  if (!items.data) return <div className="page"><ErrorBanner message={items.error ?? 'Couldn’t load packaging.'} onRetry={items.reload} /></div>;

  return (
    <div className="page">
      <PageHeader title="Packaging" subtitle="Boxes, bags, toppers — attach them to orders and they count as cost of goods in Finances."
        actions={<Button data-icon="plus" onClick={() => setEditing('new')}>Add packaging</Button>} />
      <Card>
        {!items.data.length ? (
          <EmptyState title="No packaging yet"
            body="Add the boxes, bags, toppers and anything else you send out, then attach them to orders to see your real profit."
            action={<Button onClick={() => setEditing('new')}>Add packaging</Button>} />
        ) : (
          <div className="table-scroll"><table className="table hover">
            <thead><tr><th>Description</th><th>Type</th><th className="num">Price</th><th /></tr></thead>
            <tbody>
              {items.data.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEditing(p)}>
                  <td><span className="row-title inline">{p.name}</span></td>
                  <td className="muted">{kindLabel(p)}</td>
                  <td className="num">{formatMoney(Number(p.price))}</td>
                  <td className="num" onClick={(ev) => ev.stopPropagation()}>
                    <button className="icon-btn sm" aria-label="Delete" onClick={() => setDeleting(p)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      <p className="small muted">Attach packaging from an order’s Packaging card. Changing a price here only affects orders you attach it to afterwards.</p>

      {editing && (
        <PackagingModal userId={userId} item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Packaging saved'); items.reload(); }} />
      )}
      {deleting && (
        <ConfirmModal title={`Delete “${deleting.name}”?`} body="It’s removed from your list. Orders it’s already attached to keep their cost."
          confirmLabel="Delete" danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await deletePackaging(deleting.id); items.reload(); }} />
      )}
    </div>
  );
}

export function PackagingModal({ userId, item, onClose, onSaved }: { userId: string; item?: PackagingItem; onClose: () => void; onSaved: (p: PackagingItem) => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<PackagingKind>(item?.kind ?? 'box');
  const [customKind, setCustomKind] = useState(item?.custom_kind ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = name.trim() && price.trim() !== '' && parseNumber(price) >= 0;

  return (
    <Modal title={item ? 'Edit packaging' : 'Add packaging'} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { onSaved(await savePackaging(userId, { id: item?.id, name, kind, custom_kind: customKind, price: parseNumber(price) })); }
          catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Save</Button>
      </>}>
      <Field label="Description"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 6-cookie window box" /></Field>
      <Field label="Type">
        <div className="seg">
          {PACKAGING_KINDS.map((k) => <button key={k.kind} type="button" className={kind === k.kind ? 'active' : ''} onClick={() => setKind(k.kind)}>{k.label}</button>)}
        </div>
      </Field>
      {kind === 'custom' && (
        <Field label="What is it?"><Input value={customKind} onChange={(e) => setCustomKind(e.target.value)} placeholder="e.g. Cake topper" /></Field>
      )}
      <Field label="Price per unit" hint="What one of these costs you.">
        <div className="money-input"><span>$</span><Input type="number" min="0" step="0.01" value={price} placeholder="0.00" onChange={(e) => setPrice(e.target.value)} /></div>
      </Field>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}
