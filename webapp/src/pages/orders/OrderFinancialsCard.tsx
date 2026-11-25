import { useEffect, useState } from 'react';
import { Card, Field, Input, useLoad } from '../../components/ui';
import { useAuth } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { check } from '../../lib/api';
import { formatMoney, parseNumber } from '../../lib/format';
import { effectiveTotal, patchOrder } from '../../lib/orders';
import { ingredientAmounts, ingredientCost, listCostingListings, listCostingRecipes, listIngredientCosts } from '../../lib/kitchen';
import { listOrderPackaging, lineCost } from '../../lib/packaging';
import type { Order } from '../../lib/types';

/** One order's money, like iOS OrderDetailView's Financials: revenue, ingredients
 *  and packaging, profit — then your time on it (orders.labor_minutes) at your
 *  hourly rate (profiles.hourly_wage): what you make after paying yourself, and
 *  per hour. Time and rate are edited right here, on every order. */
export function OrderFinancialsCard({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const userId = order.user_id;
  const data = useLoad(async () => {
    const [recipes, costs, listings, packaging] = await Promise.all([
      listCostingRecipes(userId), listIngredientCosts(userId), listCostingListings(userId), listOrderPackaging(userId, order.id),
    ]);
    const amounts = ingredientAmounts((order.order_items ?? []).map((i) => ({
      recipe_id: i.recipe_id, recipe_ids: i.recipe_ids, menu_item_id: i.menu_item_id, custom_name: i.custom_name, quantity: i.quantity, unit: i.unit,
    })), recipes, costs, listings);
    return { ingredients: ingredientCost(amounts), priced: amounts.some((a) => a.hasCost), packaging: packaging.reduce((s, l) => s + lineCost(l), 0) };
  }, [userId, order.id, order.updated_at]);

  const [hoursText, setHoursText] = useState('');
  const [rateText, setRateText] = useState('');
  useEffect(() => { setHoursText(order.labor_minutes ? String(+(order.labor_minutes / 60).toFixed(2)) : ''); }, [order.labor_minutes]);
  useEffect(() => { setRateText(profile?.hourly_wage ? String(profile.hourly_wage) : ''); }, [profile?.hourly_wage]);

  const revenue = effectiveTotal(order);
  const ingredients = data.data?.ingredients ?? 0;
  const packaging = data.data?.packaging ?? 0;
  const profit = revenue - ingredients - packaging;
  const hours = (order.labor_minutes ?? 0) / 60;
  const wage = Number(profile?.hourly_wage ?? 0);
  const labour = hours * wage;

  async function saveHours() {
    const minutes = Math.round(Math.max(0, parseNumber(hoursText)) * 60);
    if (minutes === (order.labor_minutes ?? 0)) return;
    await patchOrder(order, { labor_minutes: minutes });
    onChanged();
  }
  async function saveRate() {
    const v = Math.max(0, parseNumber(rateText));
    if (v === wage) return;
    check(await supabase.from('profiles').update({ hourly_wage: v > 0 ? v : null }).eq('id', userId));
    await refreshProfile();
  }

  return (
    <Card title="Financials">
      <dl className="kv">
        <dt>Revenue</dt><dd>{formatMoney(revenue)}</dd>
        {data.data?.priced && <><dt>Ingredients</dt><dd>−{formatMoney(ingredients)}</dd></>}
        {packaging > 0 && <><dt>Packaging</dt><dd>−{formatMoney(packaging)}</dd></>}
        <dt><strong>Profit</strong></dt><dd><strong>{formatMoney(profit)}</strong>{revenue > 0 && <span className="small muted"> · {Math.round((profit / revenue) * 100)}% margin</span>}</dd>
        {hours > 0 && wage > 0 && <><dt>Your time · {+hours.toFixed(2)} h × {formatMoney(wage)}/hr</dt><dd>−{formatMoney(labour)}</dd></>}
        {hours > 0 && <>
          <dt><strong>{wage > 0 ? 'After paying yourself' : 'You made'}</strong></dt>
          <dd><strong>{formatMoney(wage > 0 ? profit - labour : profit)}</strong><span className="small muted"> · {formatMoney(profit / hours)} an hour for your time</span></dd>
        </>}
      </dl>
      {!data.data?.priced && !data.loading && <p className="small muted">Add your ingredient prices (Ingredients) to include what this order cost to make.</p>}
      <div className="grid-2">
        <Field label="Time spent (hours)">
          <Input type="number" min="0" step="0.25" placeholder="0" value={hoursText} onChange={(e) => setHoursText(e.target.value)} onBlur={saveHours} />
        </Field>
        <Field label="Your hourly rate" hint="Used on every order.">
          <Input type="number" min="0" step="0.5" placeholder="0" value={rateText} onChange={(e) => setRateText(e.target.value)} onBlur={saveRate} />
        </Field>
      </div>
    </Card>
  );
}
