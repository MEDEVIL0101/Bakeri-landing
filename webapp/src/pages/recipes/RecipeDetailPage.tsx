import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ConfirmModal, EmptyState, ErrorBanner, Input, PageHeader, Spinner, useLoad, useToast } from '../../components/ui';
import { deleteRecipe, getRecipe, recipeImageURL } from '../../lib/data';
import type { RecipeIngredient } from '../../lib/types';
import { useUserId } from '../../auth/AuthProvider';
import { costPerGram, ingredientGrams, listIngredientCosts } from '../../lib/kitchen';
import { formatMoney } from '../../lib/format';

function amount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function ingredientLine(i: RecipeIngredient, scale: number): string {
  const qty = i.volume_amount * scale;
  const unit = i.volume_unit === 'none' ? '' : ` ${i.volume_unit}`;
  const grams = i.grams_per_cup > 0 && i.volume_unit === 'cup' ? ` (${Math.round(qty * i.grams_per_cup)} g)` : '';
  return qty > 0 ? `${amount(qty)}${unit}${grams}` : '';
}

export function RecipeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => getRecipe(id!), [id]);
  const [img, setImg] = useState<string | null>(null);
  const [batch, setBatch] = useState('1');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (data?.recipe) recipeImageURL(data.recipe).then(setImg);
  }, [data?.recipe]);

  if (loading) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBanner message={error} onRetry={reload} /></div>;
  if (!data) return <div className="page"><EmptyState title="Recipe not found" action={<Link to="/recipes">Back to recipes</Link>} /></div>;

  const { recipe, ingredients } = data;
  const scale = Math.max(0, Number(batch) || 0);

  return (
    <div className="page">
      <PageHeader
        back={<Link to="/recipes" className="back-link">← Recipes</Link>}
        title={recipe.name}
        subtitle={`Makes ${amount(recipe.yield_quantity * scale)} ${recipe.yield_unit}${recipe.prep_time_minutes ? ` · Prep ${recipe.prep_time_minutes} min` : ''}${recipe.bake_time_minutes ? ` · Bake ${recipe.bake_time_minutes} min` : ''}`}
        actions={<>
          <Button variant="ghost" onClick={() => setDeleting(true)}>Delete</Button>
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          <Link to={`/recipes/${recipe.id}/edit`} className="btn btn-primary">Edit</Link>
        </>}
      />
      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Ingredients" actions={
            <label className="batch">Batch × <Input className="w-num" type="number" min="0.25" step="0.25" value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
          }>
            {ingredients.length === 0 ? <p className="muted">No ingredients yet.</p> : (
              <div className="table-scroll"><table className="table">
                <tbody>
                  {ingredients.map((i) => (
                    <tr key={i.id}>
                      <td className="nowrap">{ingredientLine(i, scale)}</td>
                      <td>{i.name}{i.notes && <span className="small muted"> — {i.notes}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
          {recipe.instructions && (
            <Card title="Method">
              <ol className="steps-list">
                {recipe.instructions.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => <li key={i}><span className="step-num">{i + 1}</span><span>{l}</span></li>)}
              </ol>
            </Card>
          )}
          {recipe.notes && <Card title="Notes"><p className="prewrap">{recipe.notes}</p></Card>}
        </div>
        <div className="stack-lg">
          {img && <Card><img src={img} alt="" className="recipe-img" /></Card>}
          <CostCard ingredients={ingredients} scale={scale} yieldQty={recipe.yield_quantity * scale} yieldUnit={recipe.yield_unit} />
          {recipe.tags.length > 0 && <Card title="Tags"><div className="chips">{recipe.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div></Card>}
        </div>
      </div>
      {deleting && (
        <ConfirmModal title={`Delete “${recipe.name}”?`} body="It’s removed from Bakeri on all your devices." confirmLabel="Delete recipe" danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await deleteRecipe(recipe); toast('Recipe deleted'); navigate('/recipes'); }} />
      )}
    </div>
  );
}

/** Cost per batch / per piece from the vendor's ingredient prices (IngredientCost.swift). */
function CostCard({ ingredients, scale, yieldQty, yieldUnit }: { ingredients: RecipeIngredient[]; scale: number; yieldQty: number; yieldUnit: string }) {
  const userId = useUserId();
  const costs = useLoad(() => listIngredientCosts(userId), [userId]);
  if (!costs.data) return null;
  const byName = new Map(costs.data.map((c) => [c.ingredient_name.toLowerCase(), c]));
  let total = 0; let priced = 0;
  for (const i of ingredients) {
    const c = byName.get(i.name.toLowerCase());
    if (!c) continue;
    priced++;
    total += ingredientGrams(i) * scale * costPerGram(c);
  }
  return (
    <Card title="Ingredient cost" actions={<Link to="/ingredients" className="small">Prices →</Link>}>
      {!priced ? <p className="small muted">Add what you pay for ingredients to see what this batch costs to make.</p> : (
        <>
          <div className="cost-big">{formatMoney(total)}<span className="small muted"> per batch</span></div>
          {yieldQty > 0 && <div className="small muted">{formatMoney(total / yieldQty)} per {yieldUnit.replace(/s$/, '')}</div>}
          {priced < ingredients.length && <div className="small muted">{ingredients.length - priced} ingredient{ingredients.length - priced === 1 ? '' : 's'} without a price</div>}
        </>
      )}
    </Card>
  );
}
