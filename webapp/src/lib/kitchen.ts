import { supabase } from './supabase';
import { check } from './api';
import { newId, nowISO } from './format';
import { DENSITY_SEED } from './densitySeed';

// ── Units (iOS Enums.swift: VolumeUnit / WeightUnit / YieldUnit) ──────────

export const ML_PER: Record<string, number> = {
  cup: 236.588, tbsp: 14.7868, tsp: 4.92892, 'fl oz': 29.5735, pt: 473.176, qt: 946.353, ml: 1, L: 1000, pinch: 0.3,
};
export const GRAMS_PER: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
export const isWeightUnit = (u: string) => u === 'g' || u === 'kg' || u === 'lb';
// 'each' = bought by the piece, shown as "units" ("$4.50 for 12 units" — eggs,
// packets); it costs recipe ingredients counted with no unit ("2 Egg").
// iOS IngredientCost.eachRaw.
/** How ingredient names are compared (search, prices ↔ recipes): case- and
 *  space-insensitive, ignoring a plural "s" on each word, so "Eggs" matches
 *  "Egg". iOS String.ingredientKey — keep in step. */
export function ingredientKey(name: string): string {
  return name.toLowerCase().trim().split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

/** A counted ingredient as people say it: "1 egg", "6 eggs", "1 dozen eggs",
 *  "13 eggs", "2 dozen eggs". iOS countPhrase — keep in step. */
export function countPhrase(n: number, name: string): string {
  const one = ingredientKey(name);
  const many = /(s|x|ch|sh)$/.test(one) ? `${one}es` : `${one}s`;
  if (Number.isInteger(n) && n >= 12 && n % 12 === 0) return `${n / 12} dozen ${many}`;
  const num = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(n >= 10 ? 1 : 2)));
  return `${num} ${n === 1 ? one : many}`;
}

// Volume units (milk, cream, oil) price per ml — iOS IngredientCost.volumeUnits.
export const PURCHASE_VOLUME_UNITS = ['cup', 'tbsp', 'tsp', 'fl oz', 'pt', 'qt', 'ml', 'L'] as const;
export const PURCHASE_UNITS = ['g', 'kg', 'oz', 'lb', ...PURCHASE_VOLUME_UNITS, 'each'] as const;
export const isVolumePurchase = (u: string) => (PURCHASE_VOLUME_UNITS as readonly string[]).includes(u);
/** Millilitres of a recipe ingredient: volume units directly, weights via its density. */
export function ingredientMl(ing: RecipeIngredientLite): number {
  if (ML_PER[ing.volume_unit]) return ing.volume_amount * ML_PER[ing.volume_unit];
  if (isWeightUnit(ing.volume_unit) && ing.grams_per_cup > 0) return (ing.volume_amount * GRAMS_PER[ing.volume_unit]) / ing.grams_per_cup * ML_PER.cup;
  return 0;
}
export const purchaseUnitLabel = (u: string) => (u === 'each' ? 'units' : u);
export const isPerUnit = (u: string) => u === 'each';
/** Pieces for an ingredient counted with no unit ("2 Egg"); 0 otherwise. */
export const ingredientCount = (ing: RecipeIngredientLite) => (ing.volume_unit === 'none' ? ing.volume_amount : 0);

export interface RecipeIngredientLite { name: string; volume_amount: number; volume_unit: string; grams_per_cup: number }

/** IngredientCost.swift ingredientWeightInGrams: weight units directly, volume via the ingredient's density. */
export function ingredientGrams(ing: RecipeIngredientLite): number {
  if (isWeightUnit(ing.volume_unit)) return ing.volume_amount * GRAMS_PER[ing.volume_unit];
  const ml = ML_PER[ing.volume_unit] ?? 0;
  return ((ing.volume_amount * ml) / ML_PER.cup) * (ing.grams_per_cup || 0);
}

/** A dozen counts as 12; every other yield unit is 1:1. */
const yieldBase = (qty: number, unit: string) => (unit === 'dozen' ? qty * 12 : qty);
export function scaleFactor(itemQty: number, itemUnit: string, recipeYield: number, recipeUnit: string): number {
  const r = yieldBase(recipeYield, recipeUnit);
  return r > 0 ? yieldBase(itemQty, itemUnit) / r : itemQty;
}

// ── Ingredient costs ──────────────────────────────────────────────────────

export interface IngredientCostRow {
  id: string; user_id: string; ingredient_name: string; purchase_cost: number; purchase_amount: number; purchase_unit: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}

export function costPerGram(c: Pick<IngredientCostRow, 'purchase_cost' | 'purchase_amount' | 'purchase_unit'>): number {
  if (isPerUnit(c.purchase_unit) || isVolumePurchase(c.purchase_unit)) return 0;
  const grams = c.purchase_amount * (GRAMS_PER[c.purchase_unit] ?? GRAMS_PER.lb);
  return grams > 0 && c.purchase_cost > 0 ? c.purchase_cost / grams : 0;
}

/** Price of 1 ml (0 unless bought by volume). */
export function costPerMl(c: Pick<IngredientCostRow, 'purchase_cost' | 'purchase_amount' | 'purchase_unit'>): number {
  return isVolumePurchase(c.purchase_unit) && c.purchase_amount > 0 && c.purchase_cost > 0 ? c.purchase_cost / (c.purchase_amount * ML_PER[c.purchase_unit]) : 0;
}

/** Price of one piece (0 unless bought by the unit). */
export function costPerUnit(c: Pick<IngredientCostRow, 'purchase_cost' | 'purchase_amount' | 'purchase_unit'>): number {
  return isPerUnit(c.purchase_unit) && c.purchase_amount > 0 && c.purchase_cost > 0 ? c.purchase_cost / c.purchase_amount : 0;
}

/** What one recipe ingredient costs at this scale: by the piece when bought by
 *  the unit and the recipe counts it, otherwise by weight (mismatch → 0). */
export function lineCost(ing: RecipeIngredientLite, scale: number, c: IngredientCostRow): number {
  if (isPerUnit(c.purchase_unit)) return ingredientCount(ing) * scale * costPerUnit(c);
  if (isVolumePurchase(c.purchase_unit)) return ingredientMl(ing) * scale * costPerMl(c);
  return ingredientGrams(ing) * scale * costPerGram(c);
}

export async function listIngredientCosts(userId: string): Promise<IngredientCostRow[]> {
  return check(await supabase.from('ingredient_costs').select('*').eq('user_id', userId).is('deleted_at', null).order('ingredient_name')) as IngredientCostRow[];
}

export async function saveIngredientCost(userId: string, c: { id?: string; ingredient_name: string; purchase_cost: number; purchase_amount: number; purchase_unit: string }): Promise<void> {
  const ts = nowISO();
  const row = { id: c.id ?? newId(), user_id: userId, ingredient_name: c.ingredient_name.trim(), purchase_cost: c.purchase_cost, purchase_amount: c.purchase_amount, purchase_unit: c.purchase_unit, updated_at: ts, deleted_at: null, ...(c.id ? {} : { created_at: ts }) };
  check(await supabase.from('ingredient_costs').upsert(row, { onConflict: 'id' }));
}

export async function deleteIngredientCost(id: string): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('ingredient_costs').update({ deleted_at: ts, updated_at: ts }).eq('id', id));
}

// ── Densities (built-in seed + the vendor's custom ones) ──────────────────

export interface DensityRow { id: string; user_id: string; name: string; grams_per_cup: number; is_custom: boolean; updated_at: string; deleted_at: string | null }

export async function listDensities(userId: string): Promise<DensityRow[]> {
  return check(await supabase.from('ingredient_densities').select('*').eq('user_id', userId).is('deleted_at', null)) as DensityRow[];
}

/** Every ingredient the app knows: synced rows win, then the built-in seed. */
export function mergedDensities(rows: DensityRow[]): { name: string; grams_per_cup: number; custom?: DensityRow }[] {
  const seen = new Map<string, { name: string; grams_per_cup: number; custom?: DensityRow }>();
  for (const r of rows) seen.set(r.name.trim().toLowerCase(), { name: r.name, grams_per_cup: r.grams_per_cup, custom: r.is_custom ? r : undefined });
  for (const [name, g] of DENSITY_SEED) if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, grams_per_cup: g });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function addCustomDensity(userId: string, name: string, gramsPerCup: number): Promise<void> {
  check(await supabase.from('ingredient_densities').insert({ id: newId(), user_id: userId, name: name.trim(), grams_per_cup: gramsPerCup, is_custom: true, updated_at: nowISO() }));
}

export async function deleteCustomDensity(id: string): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('ingredient_densities').update({ deleted_at: ts, updated_at: ts }).eq('id', id));
}

// ── Cost of goods (IngredientCost.swift Order extension) ──────────────────

export interface CostingRecipe { id: string; name: string; yield_quantity: number; yield_unit: string; ingredients: RecipeIngredientLite[] }
export interface CostingItem { recipe_id: string | null; custom_name: string; quantity: number; unit: string }
export interface IngredientAmount { ingredient: string; grams: number; count: number; cost: number; hasCost: boolean }

export async function listCostingRecipes(userId: string): Promise<CostingRecipe[]> {
  const [recipes, ings] = await Promise.all([
    supabase.from('recipes').select('id, name, yield_quantity, yield_unit').eq('user_id', userId).is('deleted_at', null),
    supabase.from('recipe_ingredients').select('recipe_id, name, volume_amount, volume_unit, grams_per_cup, sort_order').eq('user_id', userId).is('deleted_at', null).order('sort_order'),
  ]);
  const all = check(ings) as (RecipeIngredientLite & { recipe_id: string })[];
  return (check(recipes) as Omit<CostingRecipe, 'ingredients'>[]).map((r) => ({ ...r, ingredients: all.filter((i) => i.recipe_id === r.id) }));
}

export function ingredientAmounts(items: CostingItem[], recipes: CostingRecipe[], costs: IngredientCostRow[]): IngredientAmount[] {
  const costMap = new Map(costs.map((c) => [ingredientKey(c.ingredient_name), c]));
  const byId = new Map(recipes.map((r) => [r.id.toLowerCase(), r]));
  const byName = new Map(recipes.map((r) => [r.name.toLowerCase(), r]));
  const out: IngredientAmount[] = [];
  for (const item of items) {
    const recipe = (item.recipe_id && byId.get(item.recipe_id.toLowerCase())) || byName.get(item.custom_name.toLowerCase());
    if (!recipe) continue;
    const scale = scaleFactor(item.quantity, item.unit, recipe.yield_quantity, recipe.yield_unit);
    for (const ing of recipe.ingredients) {
      const grams = ingredientGrams(ing) * scale;
      const count = ingredientCount(ing) * scale;
      if (!(grams > 0) && !(count > 0)) continue;
      const c = costMap.get(ingredientKey(ing.name));
      out.push({ ingredient: ing.name, grams, count, cost: c ? lineCost(ing, scale, c) : 0, hasCost: !!c });
    }
  }
  return out;
}

export const ingredientCost = (amounts: IngredientAmount[]) => amounts.reduce((s, a) => s + a.cost, 0);

export function formatWeight(grams: number, metric: boolean): string {
  if (metric) return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
  const oz = grams / GRAMS_PER.oz;
  return oz >= 16 ? `${(oz / 16).toFixed(2)} lb` : `${oz.toFixed(1)} oz`;
}
