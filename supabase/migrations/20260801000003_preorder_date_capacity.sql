-- ============================================================
-- Per-date preorder capacity
-- A multi-date preorder listing's existing "Available" cap
-- (max_preorder_quantity) now applies independently to each candidate
-- date, not once across the whole listing — Aug 6 selling out doesn't
-- affect Aug 8's availability. This is the first place in the app that
-- checks a cap against actual committed orders rather than a baker-reset
-- static display number (see MenuItem.maxPreorderQuantity's "0 = unlimited"
-- doc comment — that semantic is unchanged, just now enforced per date).
--
-- order_items has never referenced which menu_items row it came from
-- (only recipe_id, a different/optional concept, and a free-text
-- custom_name snapshot) — menu_item_id is added here specifically so
-- get_preorder_date_commitments can count real orders per listing per date.
-- Populated going forward by create-guest-marketplace-order only; existing
-- rows stay NULL (they predate per-date capacity and were never subject to
-- it, so nothing needs backfilling).
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_preorder_date
  ON public.order_items (menu_item_id, preorder_date)
  WHERE preorder_date IS NOT NULL;

-- Public (anon) read — the storefront needs this to gray out sold-out
-- dates before a buyer even starts checkout. Returns only aggregate
-- quantities per date for one listing, no PII, same exposure level as the
-- existing public get_baker_web_profile_by_* RPCs.
CREATE OR REPLACE FUNCTION public.get_preorder_date_commitments(p_menu_item_id uuid)
RETURNS TABLE(preorder_date timestamptz, committed_qty numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.preorder_date, SUM(oi.quantity) AS committed_qty
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.menu_item_id = p_menu_item_id
    AND oi.preorder_date IS NOT NULL
    AND oi.deleted_at IS NULL
    AND o.marketplace_status NOT IN ('declined', 'cancelled')
  GROUP BY oi.preorder_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_preorder_date_commitments(uuid) TO anon, authenticated;
