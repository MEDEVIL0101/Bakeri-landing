-- Atomic stock decrement for a listing_variants pick (e.g. one size/option
-- of a physical listing with has_variants — see 20260822000001/2), same
-- reasoning and shape as decrement_menu_item_stock_batch
-- (20260820000001_physical_products.sql) for a plain physical listing: one
-- Postgres transaction per call, so a mid-batch insufficient_stock failure
-- rolls back every decrement already applied in the same call.
--
-- Also keeps the parent listing's available_qty_today in sync (set at
-- save time in AddEditMenuItemView as the sum of all its variants' stock)
-- so anything still reading available_qty_today directly (badge/sold-out
-- fallbacks) doesn't drift from reality after a variant sale.
--
-- p_items shape: [{"id": "<listing_variant_id>", "qty": 2}, ...]

CREATE OR REPLACE FUNCTION public.decrement_listing_variant_stock_batch(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec JSONB;
    v_menu_item_id UUID;
BEGIN
    FOR rec IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        UPDATE public.listing_variants
        SET stock_qty = stock_qty - (rec->>'qty')::INTEGER
        WHERE id = (rec->>'id')::UUID
          AND stock_qty >= (rec->>'qty')::INTEGER
        RETURNING menu_item_id INTO v_menu_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'insufficient_stock:%', rec->>'id';
        END IF;

        UPDATE public.menu_items
        SET available_qty_today = GREATEST(0, available_qty_today - (rec->>'qty')::INTEGER)
        WHERE id = v_menu_item_id;
    END LOOP;
END;
$$;
