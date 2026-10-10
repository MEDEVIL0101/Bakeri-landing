import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, Field, Input, Modal, PageHeader, Select, useLoad, useToast } from '../../components/ui';
import { getRecipe, listRecipes, saveRecipe } from '../../lib/data';
import { GRAMS_PER, ML_PER, ingredientGrams, isWeightUnit, listDensities, mergedDensities } from '../../lib/kitchen';
import { useUnitSystem, usePref } from '../../lib/prefs';
import { TimersPanel } from './Timers';

type Mode = 'convert' | 'scale' | 'timers';

const VOLUME = ['cup', 'tbsp', 'tsp', 'fl oz', 'pt', 'qt', 'ml', 'L'];
const WEIGHT = ['g', 'kg', 'oz', 'lb'];
const RECIPE_UNITS = ['g', 'kg', 'lb', 'cup', 'tbsp', 'tsp', 'pinch', 'fl oz', 'pt', 'qt', 'ml', 'L', 'none'];

const short = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : Math.abs(n) >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, ''));

export function CalculatorPage() {
  const [mode, setMode] = usePref<Mode>('bakeri.calc.mode', 'convert');
  return (
    <div className="page">
      <PageHeader title="Calculator" subtitle="Convert, scale, and time your bakes." />
      <div className="seg seg-lg">
        <button className={mode === 'convert' ? 'active' : ''} onClick={() => setMode('convert')}>Quick convert</button>
        <button className={mode === 'scale' ? 'active' : ''} onClick={() => setMode('scale')}>Recipe scaler</button>
        <button className={mode === 'timers' ? 'active' : ''} onClick={() => setMode('timers')}>Timers</button>
      </div>
      {mode === 'convert' ? <QuickConvert /> : mode === 'scale' ? <Scaler /> : <TimersPanel />}
    </div>
  );
}

// ── Quick convert (QuickConverterView) ────────────────────────────────────

function QuickConvert() {
  const userId = useUserId();
  const densities = useLoad(() => listDensities(userId), [userId]);
  const all = useMemo(() => mergedDensities(densities.data ?? []), [densities.data]);
  const [amount, setAmount] = useState('1');
  const [from, setFrom] = useState('cup');
  const [to, setTo] = useState('g');
  const [ing, setIng] = useState('All-Purpose Flour');
  const density = all.find((d) => d.name.toLowerCase() === ing.trim().toLowerCase());
  const cross = VOLUME.includes(from) !== VOLUME.includes(to);

  const result = (() => {
    const a = parseFloat(amount);
    if (!Number.isFinite(a)) return null;
    const toGrams = (u: string, v: number) => (WEIGHT.includes(u) ? v * GRAMS_PER[u] : density ? (v * ML_PER[u] / ML_PER.cup) * density.grams_per_cup : NaN);
    if (!cross) return VOLUME.includes(from) ? (a * ML_PER[from]) / ML_PER[to] : (a * GRAMS_PER[from]) / GRAMS_PER[to];
    const g = toGrams(from, a);
    if (!Number.isFinite(g)) return null;
    return WEIGHT.includes(to) ? g / GRAMS_PER[to] : density ? (g / density.grams_per_cup) * ML_PER.cup / ML_PER[to] : null;
  })();

  return (
    <div className="detail-grid">
      <Card className="convert-card">
        <div className="convert-row">
          <Input className="convert-amount" type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          <UnitSelect value={from} onChange={setFrom} />
          <button className="icon-btn" aria-label="Swap units" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
          <UnitSelect value={to} onChange={setTo} />
        </div>
        <div className="convert-result">
          {result == null ? <span className="muted">{cross ? 'Pick an ingredient to convert between volume and weight' : '—'}</span>
            : <><span className="convert-big">{short(result)}</span> <span className="muted">{to}</span></>}
        </div>
        {cross && (
          <Field label="Ingredient" hint={density ? `${Math.round(density.grams_per_cup)} g per cup` : 'Not in your list — add it under Ingredients → Custom ingredient.'}>
            <Input list="calc-ingredients" value={ing} onChange={(e) => setIng(e.target.value)} placeholder="Search ingredients…" />
            <datalist id="calc-ingredients">{all.map((d) => <option key={d.name} value={d.name} />)}</datalist>
          </Field>
        )}
      </Card>
      {density && (
        <Card title={`Quick reference: ${density.name}`}>
          <div className="table-scroll"><table className="table compact">
            <thead><tr><th>Volume</th><th className="num">Grams</th><th className="num">Ounces</th></tr></thead>
            <tbody>
              {([['1 tsp', 1 / 48], ['1 tbsp', 1 / 16], ['¼ cup', 0.25], ['⅓ cup', 0.333], ['½ cup', 0.5], ['1 cup', 1], ['2 cups', 2]] as [string, number][]).map(([l, f]) => (
                <tr key={l}><td>{l}</td><td className="num">{short(density.grams_per_cup * f)} g</td><td className="num">{short((density.grams_per_cup * f) / GRAMS_PER.oz)} oz</td></tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}

function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select className="w-unit" value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Volume">{VOLUME.map((u) => <option key={u}>{u}</option>)}</optgroup>
      <optgroup label="Weight">{WEIGHT.map((u) => <option key={u}>{u}</option>)}</optgroup>
    </Select>
  );
}

// ── Recipe scaler (FullRecipeCalculatorView) ──────────────────────────────

interface Row { name: string; amount: string; unit: string; grams_per_cup: number }

function Scaler() {
  const userId = useUserId();
  const toast = useToast();
  const navigate = useNavigate();
  const recipes = useLoad(() => listRecipes(userId), [userId]);
  const [units] = useUnitSystem();
  const [source, setSource] = useState<{ id: string; name: string; yield_quantity: number; yield_unit: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([{ name: '', amount: '', unit: 'g', grams_per_cup: 120 }]);
  const [byYield, setByYield] = useState(false);
  const [factor, setFactor] = useState('2');
  const [desired, setDesired] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');

  async function load(id: string) {
    const r = await getRecipe(id);
    if (!r) return;
    setSource(r.recipe);
    setRows(r.ingredients.map((i) => ({ name: i.name, amount: String(i.volume_amount), unit: i.volume_unit, grams_per_cup: i.grams_per_cup })));
    setDesired(String(r.recipe.yield_quantity * 2));
  }

  const f = byYield && source && source.yield_quantity > 0 ? (parseFloat(desired) || 0) / source.yield_quantity : parseFloat(factor) || 0;
  const active = rows.filter((r) => r.name.trim() && parseFloat(r.amount) > 0);
  const gramsOf = (r: Row) => ingredientGrams({ name: r.name, volume_amount: parseFloat(r.amount) || 0, volume_unit: r.unit, grams_per_cup: r.grams_per_cup });
  const flour = active.filter((r) => /flour/i.test(r.name)).reduce((s, r) => s + gramsOf(r) * f, 0);
  const batch = active.reduce((s, r) => s + gramsOf(r) * f, 0);
  const wUnit = units === 'metric' ? 'g' : 'oz';
  const showW = (g: number) => `${short(g / GRAMS_PER[wUnit])} ${wUnit}`;

  return (
    <div className="stack-lg">
      <Card title="Recipe" actions={source && <button className="link-btn small" onClick={() => { setSource(null); setRows([{ name: '', amount: '', unit: 'g', grams_per_cup: 120 }]); }}>Start blank</button>}>
        <div className="grid-2">
          <Field label="Load one of your recipes">
            <Select value={source?.id ?? ''} onChange={(e) => e.target.value && load(e.target.value)}>
              <option value="">Choose a recipe…</option>
              {(recipes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Scale">
            <div className="seg sm">
              <button className={!byYield ? 'active' : ''} onClick={() => setByYield(false)}>By factor</button>
              <button className={byYield ? 'active' : ''} disabled={!source} onClick={() => setByYield(true)}>By yield</button>
            </div>
          </Field>
        </div>
        {byYield && source ? (
          <Field label={`Desired yield (original: ${source.yield_quantity} ${source.yield_unit})`}>
            <div className="btn-row"><Input className="w-num" type="number" min="0" step="any" value={desired} onChange={(e) => setDesired(e.target.value)} /><span className="muted">{source.yield_unit}</span><span className="muted small">= ×{short(f)}</span></div>
          </Field>
        ) : (
          <div className="btn-row">
            {['0.5', '1', '1.5', '2', '3'].map((p) => <button key={p} className={`pill ${factor === p ? 'active' : ''}`} onClick={() => setFactor(p)}>×{p}</button>)}
            <Input className="w-num" type="number" min="0" step="any" value={factor} onChange={(e) => setFactor(e.target.value)} aria-label="Custom factor" />
          </div>
        )}
      </Card>

      <div className="stats">
        <div className="stat"><span className="stat-label">Flour weight</span><span className="stat-value">{showW(flour)}</span></div>
        <div className="stat stat-hero"><span className="stat-label">Total batch</span><span className="stat-value">{showW(batch)}</span></div>
        <div className="stat"><span className="stat-label">Ingredients</span><span className="stat-value">{active.length}</span></div>
      </div>

      <Card title="Ingredients" actions={<Button variant="secondary" disabled={!active.length || f <= 0} onClick={() => { setSaveName(`${source?.name ?? 'Recipe'} ×${short(f)}`); setSaving(true); }}>Save as new recipe</Button>}>
        <div className="scale-table">
          <div className="scale-head small muted"><span>Ingredient</span><span>Original</span><span /><span className="num">Scaled</span><span /></div>
          {rows.map((r, i) => {
            const a = parseFloat(r.amount) || 0;
            return (
              <div key={i} className="scale-row">
                <Input value={r.name} placeholder="Ingredient" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input type="number" min="0" step="any" value={r.amount} placeholder="Qty" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Select value={r.unit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}>{RECIPE_UNITS.map((u) => <option key={u} value={u}>{u === 'none' ? '—' : u}</option>)}</Select>
                <span className="num scaled">{a > 0 ? `${short(a * f)} ${r.unit === 'none' ? '' : r.unit}` : '—'}{a > 0 && !isWeightUnit(r.unit) && r.unit !== 'none' && r.unit !== 'pinch' && <span className="muted small"> · {short(gramsOf(r) * f)} g</span>}</span>
                <button className="icon-btn sm" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
              </div>
            );
          })}
          <div><Button variant="secondary" onClick={() => setRows([...rows, { name: '', amount: '', unit: 'g', grams_per_cup: 120 }])}>Add ingredient</Button></div>
        </div>
      </Card>

      {saving && (
        <Modal title="Save scaled recipe" onClose={() => setSaving(false)}
          footer={<>
            <Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
            <Button disabled={!saveName.trim()} onClick={async () => {
              const id = await saveRecipe(userId, {
                name: saveName, yield_quantity: source ? Math.round(source.yield_quantity * f * 100) / 100 : 1, yield_unit: source?.yield_unit ?? 'servings',
                prep_time_minutes: 0, bake_time_minutes: 0, instructions: '', notes: source ? `Scaled ×${short(f)} from ${source.name}` : '', tags: [], is_favorite: false,
              }, active.map((r) => ({ name: r.name, volume_amount: Math.round((parseFloat(r.amount) || 0) * f * 1000) / 1000, volume_unit: r.unit, grams_per_cup: r.grams_per_cup, notes: '' })), [], null, false);
              toast('Recipe saved');
              navigate(`/recipes/${id}`);
            }}>Save</Button>
          </>}>
          <Field label="Name"><Input value={saveName} onChange={(e) => setSaveName(e.target.value)} /></Field>
          <p className="small muted">This saves the current scaled amounts as a new recipe.</p>
        </Modal>
      )}
    </div>
  );
}
