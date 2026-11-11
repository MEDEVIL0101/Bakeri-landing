// Pre-sales (migration 20261110000002): a listing whose presale_release_at is
// still ahead is sold now and ships / arrives / opens on that date;
// presale_order_by closes checkout early; sell_limit caps digital, course and
// club sales (physical keeps its stock count).
// deno-lint-ignore-file no-explicit-any

export const PRESALE_COLS = "presale_release_at, presale_order_by, sell_limit, sold_count";

/** The release date while the pre-sale is on, else null (a normal listing). */
export function presaleRelease(m: any, now = Date.now()): string | null {
  const at = m?.presale_release_at ? Date.parse(m.presale_release_at) : NaN;
  return Number.isFinite(at) && at > now ? new Date(at).toISOString() : null;
}

/** Why this listing can't be bought right now (pre-orders closed, sold out), or null. */
export function presaleCheckoutError(m: any, qty: number, now = Date.now()): string | null {
  const orderBy = m?.presale_order_by ? Date.parse(m.presale_order_by) : NaN;
  if (presaleRelease(m, now) && Number.isFinite(orderBy) && orderBy < now) {
    return `Pre-orders for "${m.name}" have closed.`;
  }
  if (m?.sell_limit != null && (m.sold_count ?? 0) + qty > m.sell_limit) {
    const left = Math.max(0, m.sell_limit - (m.sold_count ?? 0));
    return left > 0 ? `Only ${left} of "${m.name}" left.` : `"${m.name}" is sold out.`;
  }
  return null;
}

/** "Mon, Dec 8" — dates in emails and order notes. */
export function releaseLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Toronto" });
}

/** Counts each listing's lines toward its sell limit, all or nothing. */
export async function claimSellLimits(db: any, menuItemIds: string[]): Promise<string | null> {
  const qty = new Map<string, number>();
  menuItemIds.forEach((id) => qty.set(id, (qty.get(id) ?? 0) + 1));
  if (!qty.size) return null;
  const { error } = await db.rpc("claim_sell_limit_batch", { p_items: [...qty].map(([id, q]) => ({ id, qty: q })) });
  if (!error) return null;
  const id = /sell_limit_reached:([0-9a-f-]+)/i.exec(error.message)?.[1] ?? null;
  console.error("claim_sell_limit_batch:", error.message);
  return id ?? "";
}
