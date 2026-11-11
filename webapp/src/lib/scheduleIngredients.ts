// Ingredients for a stretch of the Schedule (iOS: ScheduleView's
// ingredientOrders + aggregateIngredients + IngredientsGlanceCard) — keep the
// two in step.
import type { BakingTask, Order } from './types';
import { ingredientKey, type CostingRecipe } from './kitchen';

export interface MenuRecipeLink { name: string; recipe_id: string | null; recipe_ids: string[] | null }
export interface NeededIngredient { name: string; amounts: { amount: number; unit: string }[] }

const taskOrderIds = (t: BakingTask): string[] => (t.order_ids?.length ? t.order_ids : t.order_id ? [t.order_id] : []);

/**
 * The orders whose ingredients belong to [start, end):
 *  1. an order with baking tasks counts in the period of its EARLIEST task
 *     (when the baking actually starts) — "due the 10th, baked the 2nd" shows
 *     in the week of the 2nd;
 *  2. an order with no tasks falls back to its due date.
 */
export function ingredientOrders(orders: Order[], tasks: BakingTask[], start: Date, end: Date): Order[] {
  const inRange = (iso: string) => { const t = new Date(iso).getTime(); return t >= start.getTime() && t < end.getTime(); };
  const earliest = new Map<string, number>();
  for (const t of tasks) {
    const at = new Date(t.due_date).getTime();
    for (const id of taskOrderIds(t)) earliest.set(id, Math.min(earliest.get(id) ?? Infinity, at));
  }
  return orders.filter((o) => {
    const first = earliest.get(o.id);
    return first !== undefined ? first >= start.getTime() && first < end.getTime() : inRange(o.due_date);
  });
}

/** Everything the orders and tasks need, summed per ingredient in each recipe unit. */
export function neededIngredients(orders: Order[], tasks: BakingTask[], recipes: CostingRecipe[], menu: MenuRecipeLink[]): NeededIngredient[] {
  const byId = new Map(recipes.map((r) => [r.id.toLowerCase(), r]));
  const menuByName = new Map(menu.map((m) => [m.name.trim().toLowerCase(), m]));
  const accum = new Map<string, Map<string, number>>();
  const used = new Set<string>();
  const add = (r: CostingRecipe, scale: number) => {
    used.add(r.id.toLowerCase());
    for (const ing of r.ingredients) {
      const key = ingredientKey(ing.name);   // "Eggs" + "Egg" add up
      if (!key) continue;
      const units = accum.get(key) ?? new Map<string, number>();
      units.set(ing.volume_unit, (units.get(ing.volume_unit) ?? 0) + ing.volume_amount * scale);
      accum.set(key, units);
    }
  };
  for (const o of orders) {
    for (const item of o.order_items ?? []) {
      if (item.deleted_at) continue;
      // An item's own recipe, else every recipe on the product of that name.
      const own = item.recipe_id ? byId.get(item.recipe_id.toLowerCase()) : undefined;
      const m = own ? undefined : menuByName.get(item.custom_name.trim().toLowerCase());
      const ids = own ? [own.id] : m ? (m.recipe_ids?.length ? m.recipe_ids : m.recipe_id ? [m.recipe_id] : []) : [];
      for (const id of ids) {
        const r = byId.get(id.toLowerCase());
        if (r && r.yield_quantity > 0) add(r, item.quantity / r.yield_quantity);
      }
    }
  }
  // A task's recipe, unless an order already covered it (one batch).
  for (const t of tasks) {
    const r = t.recipe_id ? byId.get(t.recipe_id.toLowerCase()) : undefined;
    if (r && r.yield_quantity > 0 && !used.has(r.id.toLowerCase())) add(r, 1);
  }
  const unitOrder = ['g', 'kg', 'cup', 'tbsp', 'tsp', 'fl oz', 'pt', 'qt', 'ml', 'L', 'none'];
  return [...accum.entries()]
    .map(([key, units]) => ({
      name: key.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      amounts: [...units.entries()]
        .map(([unit, amount]) => ({ unit, amount }))
        .sort((a, b) => (unitOrder.indexOf(a.unit) + 1 || 99) - (unitOrder.indexOf(b.unit) + 1 || 99)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "2 cup + 500 ml" — whole numbers plain, else up to 2 decimals (1 past 10). */
export function formatAmounts(amounts: { amount: number; unit: string }[]): string {
  const neat = (v: number) => Number.isInteger(v) ? String(v) : v >= 10 ? v.toFixed(1) : String(Number(v.toFixed(2)));
  return amounts.map((a) => (a.unit === 'none' || !a.unit ? neat(a.amount) : `${neat(a.amount)} ${a.unit}`)).join(' + ') || '—';
}
