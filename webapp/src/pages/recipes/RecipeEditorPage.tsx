import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Textarea, Toggle, useLoad, useToast } from '../../components/ui';
import { getRecipe, recipeImageURL, saveRecipe, type IngredientDraft } from '../../lib/data';
import { compressImage } from '../../lib/menu';
import { parseNumber } from '../../lib/format';
import { densityFor, extractRecipe, type ImportedRecipe } from '../../lib/recipeAI';

// Raw values of VolumeUnit / YieldUnit (Models/Enums.swift).
const VOLUME_UNITS = ['cup', 'tbsp', 'tsp', 'fl oz', 'pt', 'qt', 'ml', 'L', 'g', 'kg', 'lb', 'pinch', 'none'];
const YIELD_UNITS = ['servings', 'pieces', 'dozen', 'cookies', 'bars', 'brownies', 'shortbreads', 'biscotti', 'cakes', 'cupcakes', '6-inch cakes', '8-inch cakes', '9-inch cakes', '10-inch cakes', 'sheet cakes', 'bundt cakes', 'cheesecakes', 'cake pops', 'pies', '6-inch pies', '8-inch pies', '9-inch pies', '10-inch pies', 'mini pies', 'tarts', 'mini tarts', 'muffins', 'scones', 'croissants', 'donuts', 'eclairs', 'macarons', 'truffles', 'crepes', 'waffles', 'pancakes', 'loaves', 'rolls', 'buns', 'bagels', 'pretzels', 'biscuits', 'breadsticks'];

export function RecipeEditorPage() {
  const { id } = useParams();
  const userId = useUserId();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useLoad(() => (id ? getRecipe(id) : Promise.resolve(null)), [id]);

  const [name, setName] = useState('');
  const [yieldQty, setYieldQty] = useState('12');
  const [yieldUnit, setYieldUnit] = useState('cookies');
  const [prep, setPrep] = useState('0');
  const [bake, setBake] = useState('0');
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [fav, setFav] = useState(false);
  const [ings, setIngs] = useState<IngredientDraft[]>([]);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    const r = d.recipe;
    setName(r.name); setYieldQty(String(r.yield_quantity)); setYieldUnit(r.yield_unit);
    setPrep(String(r.prep_time_minutes)); setBake(String(r.bake_time_minutes));
    setInstructions(r.instructions); setNotes(r.notes); setTags(r.tags.join(', ')); setFav(r.is_favorite);
    setIngs(d.ingredients.map((i) => ({ id: i.id, name: i.name, volume_amount: i.volume_amount, volume_unit: i.volume_unit, grams_per_cup: i.grams_per_cup, notes: i.notes })));
    recipeImageURL(r).then((u) => u && setPreview(u));
  }, [existing.data]);

  if (id && existing.loading) return <div className="page"><Spinner /></div>;

  const updIng = (i: number, p: Partial<IngredientDraft>) => setIngs(ings.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Give the recipe a name.'); return; }
    setBusy(true); setError(null);
    try {
      const savedId = await saveRecipe(
        userId,
        {
          id, name, yield_quantity: parseNumber(yieldQty) || 1, yield_unit: yieldUnit,
          prep_time_minutes: Math.round(parseNumber(prep)), bake_time_minutes: Math.round(parseNumber(bake)),
          instructions, notes, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), is_favorite: fav,
        },
        ings,
        existing.data?.ingredients ?? [],
        image,
        existing.data?.recipe.has_image ?? false,
      );
      toast('Recipe saved');
      navigate(`/recipes/${savedId}`);
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <form className="page" onSubmit={submit}>
      <PageHeader
        back={<Link to={id ? `/recipes/${id}` : '/recipes'} className="back-link">← {id ? 'Recipe' : 'Recipes'}</Link>}
        title={id ? 'Edit recipe' : 'New recipe'}
        actions={<Button type="submit" loading={busy}>Save</Button>}
      />
      {error && <ErrorBanner message={error} />}
      {!id && <ImportPanel onImported={(r) => {
        setName(r.name || name);
        if (r.yield_quantity) setYieldQty(String(r.yield_quantity));
        if (r.yield_unit) setYieldUnit(r.yield_unit);
        if (r.prep_time_minutes != null) setPrep(String(r.prep_time_minutes));
        if (r.bake_time_minutes != null) setBake(String(r.bake_time_minutes));
        setInstructions(r.instructions); setNotes(r.notes); setTags(r.tags.join(', '));
        setIngs(r.ingredients.map((x) => ({ name: x.name, volume_amount: x.amount, volume_unit: x.unit, grams_per_cup: x.grams_per_cup, notes: '' })));
        toast('Recipe imported — check it over, then save');
      }} />}
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Recipe">
            <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid-2">
              <Field label="Makes"><Input type="number" min="0" step="any" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} /></Field>
              <Field label="Unit">
                <Select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)}>
                  {(YIELD_UNITS.includes(yieldUnit) ? YIELD_UNITS : [yieldUnit, ...YIELD_UNITS]).map((u) => <option key={u}>{u}</option>)}
                </Select>
              </Field>
              <Field label="Prep (minutes)"><Input type="number" min="0" value={prep} onChange={(e) => setPrep(e.target.value)} /></Field>
              <Field label="Bake (minutes)"><Input type="number" min="0" value={bake} onChange={(e) => setBake(e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Ingredients">
            <div className="rows-editor">
              {ings.map((ing, i) => (
                <div key={ing.id ?? `n${i}`} className="item-edit-row">
                  <Input className="w-num" type="number" min="0" step="any" aria-label="Amount" value={ing.volume_amount || ''} onChange={(e) => updIng(i, { volume_amount: parseNumber(e.target.value) })} />
                  <Select className="w-unit" aria-label="Unit" value={ing.volume_unit} onChange={(e) => updIng(i, { volume_unit: e.target.value })}>
                    {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u === 'none' ? '—' : u}</option>)}
                  </Select>
                  <Input className="grow" placeholder="Ingredient" value={ing.name} onChange={(e) => updIng(i, { name: e.target.value })}
                    onBlur={() => { if (ing.name.trim() && (!ing.grams_per_cup || ing.grams_per_cup === 120)) updIng(i, { grams_per_cup: densityFor(ing.name) }); }} />
                  <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setIngs(ings.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={() => setIngs([...ings, { name: '', volume_amount: 1, volume_unit: 'cup', grams_per_cup: 120, notes: '' }])}>Add ingredient</Button>
            </div>
          </Card>
          <Card title="Method"><Textarea rows={10} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Card>
          <Card title="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Card>
        </div>
        <div className="stack-lg">
          <Card title="Photo">
            <label className="photo-drop">
              {preview ? <img src={preview} alt="" /> : <span className="muted">Click to add a photo</span>}
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { const b = await compressImage(f); setImage(b); setPreview(URL.createObjectURL(b)); } catch (err: any) { setError(err.message); }
              }} />
            </label>
          </Card>
          <Card title="Organise">
            <Field label="Tags" hint="Separate with commas."><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cookies, holiday" /></Field>
            <Toggle checked={fav} onChange={setFav} label="Favourite" />
          </Card>
        </div>
      </div>
    </form>
  );
}

function ImportPanel({ onImported }: { onImported: (r: ImportedRecipe) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="import-cta" onClick={() => setOpen(true)}>
        <span className="import-spark" aria-hidden>✦</span>
        <span className="grow"><strong>Import a recipe</strong><span className="small muted">Paste text or upload a photo of a handwritten or printed recipe — the ingredients and steps fill in automatically.</span></span>
        <span className="chev">›</span>
      </button>
    );
  }
  return (
    <Card title="Import a recipe" actions={<button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setOpen(false)}>×</button>}>
      <div className="grid-2">
        <Field label="Recipe text"><Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your recipe here — ingredients, steps, everything…" /></Field>
        <Field label="…or photos">
          <label className="file-drop tall" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setPhotos([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).slice(0, 4)); }}>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 4))} />
            {photos.length ? <><strong>{photos.length} photo{photos.length === 1 ? '' : 's'} ready</strong><span className="small muted">{photos.map((p) => p.name).join(', ')}</span></>
              : <><strong>Choose photos</strong><span className="small muted">Handwritten note, printed recipe, or screenshot (up to 4)</span></>}
          </label>
        </Field>
      </div>
      {err && <ErrorBanner message={err} />}
      <div className="btn-row">
        <Button type="button" loading={busy} disabled={!text.trim() && !photos.length} onClick={async () => {
          setBusy(true); setErr(null);
          try { onImported(await extractRecipe(photos.length ? { photos } : { text })); setOpen(false); setText(''); setPhotos([]); }
          catch (e: any) { setErr(e.message); }
          setBusy(false);
        }}>{busy ? 'Reading your recipe…' : 'Import'}</Button>
        {busy && <span className="small muted">This can take up to a minute for longer recipes.</span>}
      </div>
    </Card>
  );
}
