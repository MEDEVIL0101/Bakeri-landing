import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, useLoad, useToast } from '../../components/ui';
import {
  PURCHASE_UNITS, addCustomDensity, costPerGram, deleteCustomDensity, deleteIngredientCost, listDensities, listIngredientCosts,
  mergedDensities, saveIngredientCost, type DensityRow, type IngredientCostRow,
} from '../../lib/kitchen';
import { formatMoney, parseNumber } from '../../lib/format';

type Filter = 'priced' | 'all' | 'custom';

/** Mirrors iOS IngredientsView: densities + purchase costs, merged by name. */
export function IngredientsPage() {
  const userId = useUserId();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const data = useLoad(async () => {
    const [costs, densities] = await Promise.all([listIngredientCosts(userId), listDensities(userId)]);
    return { costs, densities };
  }, [userId]);
  const [filter, setFilter] = useState<Filter>('priced');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ name: string; cost?: IngredientCostRow } | null>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const [deleting, setDeleting] = useState<{ cost?: IngredientCostRow; custom?: DensityRow } | null>(null);

  // Deep link from Finances: /ingredients?add=Butter
  useEffect(() => {
    const add = params.get('add');
    if (add && data.data) { setEditing({ name: add, cost: data.data.costs.find((c) => c.ingredient_name.toLowerCase() === add.toLowerCase()) }); setParams({}, { replace: true }); }
  }, [params, data.data, setParams]);

  const entries = useMemo(() => {
    if (!data.data) return [];
    const costBy = new Map<string, IngredientCostRow>();
    for (const c of data.data.costs) { const k = c.ingredient_name.trim().toLowerCase(); if (!costBy.has(k)) costBy.set(k, c); }
    const list = mergedDensities(data.data.densities).map((d) => ({ ...d, cost: costBy.get(d.name.toLowerCase()) }));
    const seen = new Set(list.map((l) => l.name.toLowerCase()));
    for (const [k, c] of costBy) if (!seen.has(k)) list.push({ name: c.ingredient_name, grams_per_cup: 0, cost: c });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [data.data]);

  const visible = entries.filter((e) => {
    if (filter === 'priced' && !e.cost) return false;
    if (filter === 'custom' && !e.custom) return false;
    return !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase());
  });

  if (data.loading && !data.data) return <div className="page"><Spinner /></div>;
  if (!data.data) return <div className="page"><ErrorBanner message={data.error ?? 'Couldn’t load ingredients.'} onRetry={data.reload} /></div>;

  return (
    <div className="page">
      <PageHeader title="Ingredients" subtitle="Set what you pay for ingredients — it becomes cost of goods and profit on every order."
        actions={<>
          <Button variant="secondary" onClick={() => setAddingCustom(true)}>Custom ingredient</Button>
          <Button onClick={() => setEditing({ name: '' })}>Add a price</Button>
        </>} />
      <div className="toolbar">
        <div className="seg">
          {(['priced', 'all', 'custom'] as Filter[]).map((f) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'priced' ? `Priced (${data.data!.costs.length})` : f === 'all' ? 'All' : 'Custom'}</button>)}
        </div>
        <Input className="search" type="search" placeholder="Search ingredients" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        {!visible.length ? (
          <EmptyState title={filter === 'priced' ? 'No prices yet' : 'Nothing matches'}
            body={filter === 'priced' ? 'Click “Add a price” or switch to All to price an ingredient you use.' : undefined} />
        ) : (
          <div className="table-scroll"><table className="table hover">
            <thead><tr><th>Ingredient</th><th className="num">g / cup</th><th>You pay</th><th className="num">Per lb</th><th /></tr></thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.name} onClick={() => setEditing({ name: e.name, cost: e.cost })} className="clickable">
                  <td><span className="row-title inline">{e.name}</span> {e.custom && <Badge tone="blue">Custom</Badge>}</td>
                  <td className="num muted">{e.grams_per_cup ? Math.round(e.grams_per_cup) : '—'}</td>
                  <td>{e.cost ? `${formatMoney(e.cost.purchase_cost)} for ${e.cost.purchase_amount} ${e.cost.purchase_unit}` : <span className="muted small">Add cost</span>}</td>
                  <td className="num">{e.cost ? formatMoney(costPerGram(e.cost) * 453.592) : ''}</td>
                  <td className="num" onClick={(ev) => ev.stopPropagation()}>
                    {(e.cost || e.custom) && <button className="icon-btn sm" aria-label="Delete" onClick={() => setDeleting({ cost: e.cost, custom: e.custom })}>×</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {editing && (
        <CostModal userId={userId} initial={editing} names={entries.map((e) => e.name)}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Price saved'); data.reload(); }} />
      )}
      {addingCustom && (
        <CustomModal userId={userId} existing={entries.map((e) => e.name.toLowerCase())}
          onClose={() => setAddingCustom(false)} onSaved={() => { setAddingCustom(false); toast('Ingredient added'); data.reload(); }} />
      )}
      {deleting && (
        <ConfirmModal
          title={deleting.custom ? `Delete “${deleting.custom.name}”?` : `Remove the price for “${deleting.cost!.ingredient_name}”?`}
          body={deleting.custom ? 'Your custom ingredient is removed. Any price you’ve set for it is kept.' : 'Orders stop counting a cost for this ingredient.'}
          confirmLabel="Delete" danger onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (deleting.custom) await deleteCustomDensity(deleting.custom.id);
            else if (deleting.cost) await deleteIngredientCost(deleting.cost.id);
            data.reload();
          }}>
          {deleting.custom && deleting.cost && (
            <Button variant="ghost" onClick={async () => { await deleteIngredientCost(deleting.cost!.id); setDeleting(null); data.reload(); }}>Remove just the price instead</Button>
          )}
        </ConfirmModal>
      )}
    </div>
  );
}

function CostModal({ userId, initial, names, onClose, onSaved }: { userId: string; initial: { name: string; cost?: IngredientCostRow }; names: string[]; onClose: () => void; onSaved: () => void }) {
  const c = initial.cost;
  const [name, setName] = useState(c?.ingredient_name ?? initial.name);
  const [paid, setPaid] = useState(c ? String(c.purchase_cost) : '');
  const [amount, setAmount] = useState(c ? String(c.purchase_amount) : '');
  const [unit, setUnit] = useState(c?.purchase_unit ?? 'lb');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cpg = costPerGram({ purchase_cost: parseNumber(paid), purchase_amount: parseNumber(amount), purchase_unit: unit });
  const ok = name.trim() && cpg > 0;
  return (
    <Modal title={c ? 'Edit price' : 'Add a price'} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await saveIngredientCost(userId, { id: c?.id, ingredient_name: name, purchase_cost: parseNumber(paid), purchase_amount: parseNumber(amount), purchase_unit: unit }); onSaved(); }
          catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Save</Button>
      </>}>
      <Field label="Ingredient">
        <Input list="ingredient-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Search & select ingredient…" />
        <datalist id="ingredient-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      </Field>
      <div className="purchase-row">
        <span>I paid</span>
        <div className="money-input"><span>$</span><Input type="number" min="0" step="0.01" value={paid} placeholder="0.00" onChange={(e) => setPaid(e.target.value)} /></div>
        <span>for</span>
        <Input className="w-num" type="number" min="0" step="any" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} />
        <Select className="w-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>{PURCHASE_UNITS.map((u) => <option key={u}>{u}</option>)}</Select>
      </div>
      {cpg > 0 && <p className="small muted">= {formatMoney(cpg * 453.592)}/lb · {formatMoney(cpg * 28.3495)}/oz · {formatMoney(cpg * 1000)}/kg</p>}
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}

function CustomModal({ userId, existing, onClose, onSaved }: { userId: string; existing: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dup = existing.includes(name.trim().toLowerCase());
  return (
    <Modal title="Custom ingredient" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim() || dup || !(parseNumber(grams) > 0)} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await addCustomDensity(userId, name, parseNumber(grams)); onSaved(); } catch (e: any) { setErr(e.message); setBusy(false); }
        }}>Add</Button>
      </>}>
      <Field label="Name" error={dup ? `“${name.trim()}” is already in your ingredients list.` : null}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Almond Milk" /></Field>
      <Field label="Grams per cup" hint="Example: all-purpose flour = 120 g/cup. Used to convert cups to grams in recipes and costs.">
        <Input type="number" min="0" step="any" value={grams} onChange={(e) => setGrams(e.target.value)} />
      </Field>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}
