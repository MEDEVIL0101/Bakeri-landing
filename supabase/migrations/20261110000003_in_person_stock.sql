-- In-person sales count against stock (Harvey 2026-11-10: one inventory for
-- online and in person). The app's Tap to Pay Quick Sale calls this when a
-- sale of picked products completes (card or cash). Owner-only, never blocks —
-- the item is already in the buyer's hand — and floors at 0. Limited
-- downloads / courses / clubs count toward sold_count too.
-- p_items: [{"id": "<menu_item_id>", "qty": 2}, ...]
CREATE OR REPLACE FUNCTION public.record_in_person_sale(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec JSONB;
BEGIN
    FOR rec IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        UPDATE public.menu_items
        SET available_qty_today = CASE WHEN listing_kind IN ('physical', 'ready_now')
                                       THEN GREATEST(available_qty_today - (rec->>'qty')::INTEGER, 0)
                                       ELSE available_qty_today END,
            sold_count = CASE WHEN sell_limit IS NOT NULL THEN sold_count + (rec->>'qty')::INTEGER ELSE sold_count END,
            updated_at = now()
        WHERE id = (rec->>'id')::UUID AND user_id = auth.uid();
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.record_in_person_sale(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_in_person_sale(JSONB) TO authenticated;
