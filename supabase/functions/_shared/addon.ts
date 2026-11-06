// Limited-time add-on (migration 20261106000002). A line sent with bump_of =
// <offering product id> gets menu_items.addon_offer.price instead of its own
// price — only when the offering product is in the same order, the offer
// points at this product, it hasn't ended, and the line isn't a variant.
// deno-lint-ignore-file no-explicit-any

export interface AddonLine { menu_item_id: string; variant_id?: string | null; bump_of?: string | null }

/** index → the add-on price in cents, for each line that qualifies. */
export async function addonPrices(db: any, lines: AddonLine[], otherIds: string[] = []): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const parents = [...new Set(lines.map((l) => l.bump_of).filter((x): x is string => !!x))];
  if (!parents.length) return out;
  const inOrder = new Set([...lines.map((l) => l.menu_item_id), ...otherIds]);
  const { data } = await db.from("menu_items").select("id, addon_offer").in("id", parents).is("deleted_at", null);
  const offers = new Map<string, any>((data ?? []).map((r: any) => [r.id, r.addon_offer]));
  const used = new Set<string>();
  lines.forEach((l, i) => {
    const offer = l.bump_of ? offers.get(l.bump_of) : null;
    if (!offer || l.variant_id || !inOrder.has(l.bump_of!) || used.has(l.bump_of!)) return;
    if (String(offer.menu_item_id ?? "").toLowerCase() !== l.menu_item_id.toLowerCase()) return;
    if (offer.ends_at && new Date(offer.ends_at).getTime() < Date.now()) return;
    const price = Number(offer.price);
    if (!Number.isFinite(price) || price < 0) return;
    used.add(l.bump_of!);   // one add-on per offering product
    out.set(i, Math.round(price * 100));
  });
  return out;
}
