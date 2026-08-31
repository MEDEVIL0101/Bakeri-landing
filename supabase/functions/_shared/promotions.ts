// Shared promotion (percent-off sale) resolution for every checkout /
// finalize edge function. The rules live in SQL (resolve_effective_prices /
// effective_unit_price, migrations 20260828000002+) — this is a thin
// positional wrapper so create-payment-intent and the finalize functions
// all discount the same way from the same authoritative base prices.
//
// v1: percent-off only. `custom` listings are never discounted (the SQL
// enforces that). Automatic sales apply with `code = null`; a code only
// applies when passed and valid.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface BaseLine {
  menu_item_id: string;
  listing_kind: string;
  unit_price_cents: number; // authoritative, pre-discount (from menu_items / listing_variants / tiers)
  quantity: number;
}

export interface ResolvedLine extends BaseLine {
  effective_unit_price_cents: number; // == unit_price_cents when nothing applies
  promotion_id: string | null;
  promo_label: string | null;
}

export interface PromoResolution {
  lines: ResolvedLine[];
  codeStatus: "none" | "valid" | "invalid" | "expired" | "not_started" | "used_up";
  codePromotionId: string | null;
  totalDiscountCents: number;
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

// `lines` order is preserved — the SQL returns one entry per input line in
// the same order, matched positionally (menu_item_id can repeat across
// variant picks of the same listing).
export async function resolvePromotions(
  bakerId: string,
  lines: BaseLine[],
  code: string | null,
): Promise<PromoResolution> {
  const passthrough = (): PromoResolution => ({
    lines: lines.map((l) => ({
      ...l,
      effective_unit_price_cents: l.unit_price_cents,
      promotion_id: null,
      promo_label: null,
    })),
    codeStatus: "none",
    codePromotionId: null,
    totalDiscountCents: 0,
  });

  if (!bakerId || lines.length === 0) return passthrough();

  try {
    const { data, error } = await serviceClient().rpc("resolve_effective_prices", {
      p_user_id: bakerId,
      p_items: lines.map((l) => ({
        menu_item_id: l.menu_item_id,
        listing_kind: l.listing_kind,
        unit_price: l.unit_price_cents / 100, // resolver works in dollars
        qty: l.quantity,
      })),
      p_code: code && code.trim() ? code.trim() : null,
    });
    if (error || !data) {
      // Fail open — a promo-layer hiccup must never block a checkout.
      console.error("resolvePromotions: resolve_effective_prices failed:", error?.message);
      return passthrough();
    }

    const rlines: any[] = Array.isArray(data.lines) ? data.lines : [];
    const resolved: ResolvedLine[] = lines.map((l, i) => {
      const rl = rlines[i] ?? {};
      const eff = rl.effective_unit_price != null
        ? Math.round(Number(rl.effective_unit_price) * 100)
        : l.unit_price_cents;
      return {
        ...l,
        // Guard against float drift / a bad row ever pricing something up.
        effective_unit_price_cents: Math.min(eff, l.unit_price_cents),
        promotion_id: rl.promotion_id ?? null,
        promo_label: rl.label ?? null,
      };
    });

    const totalDiscountCents = resolved.reduce(
      (s, l) => s + (l.unit_price_cents - l.effective_unit_price_cents) * l.quantity,
      0,
    );

    return {
      lines: resolved,
      codeStatus: (data.code_status ?? "none") as PromoResolution["codeStatus"],
      codePromotionId: data.code_promotion_id ?? null,
      totalDiscountCents,
    };
  } catch (err) {
    console.error("resolvePromotions threw:", err instanceof Error ? err.message : err);
    return passthrough();
  }
}

// Bump a coded promo's redemption count once an order is finalized.
// No-op for automatic sales (promotionId null) or a codeStatus that wasn't
// "valid". Safe to call more than once only if the caller guards against
// double-finalize — it always increments.
export async function redeemPromoCode(promotionId: string | null): Promise<void> {
  if (!promotionId) return;
  try {
    await serviceClient().rpc("redeem_promo_code", { p_promotion_id: promotionId });
  } catch (err) {
    console.error("redeemPromoCode failed:", err instanceof Error ? err.message : err);
  }
}
