-- baker/pay-quote.html can't reliably resolve a menu item's photo itself:
-- the public read policy on menu_items only allows is_listed_in_marketplace
-- rows, and a custom-order listing (the whole point of this page) often
-- isn't one. Resolving it here instead (SECURITY DEFINER bypasses RLS)
-- mirrors _shared/receiptEmailStyle.ts's resolveItemImageUrl exactly:
-- order_items.menu_item_id when it's set and has_image, else an exact
-- case-insensitive name match against the baker's own listings, only
-- trusted when it resolves to exactly one row.

CREATE OR REPLACE FUNCTION public.resolve_order_item_image_id(p_user_id UUID, p_menu_item_id UUID, p_custom_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_has_image BOOLEAN;
    v_match_count INT;
BEGIN
    IF p_menu_item_id IS NOT NULL THEN
        SELECT has_image INTO v_has_image FROM menu_items WHERE id = p_menu_item_id;
        RETURN CASE WHEN v_has_image THEN p_menu_item_id ELSE NULL END;
    END IF;

    SELECT count(*) INTO v_match_count FROM menu_items
        WHERE user_id = p_user_id AND lower(name) = lower(p_custom_name) AND deleted_at IS NULL;
    IF v_match_count = 1 THEN
        SELECT id INTO v_id FROM menu_items
            WHERE user_id = p_user_id AND lower(name) = lower(p_custom_name) AND deleted_at IS NULL AND has_image
            LIMIT 1;
        RETURN v_id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_quote_details(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'order_id',            o.id,
        'order_name',          o.order_name,
        'customer_name',       o.customer_name,
        'quoted_price',        o.quoted_price,
        'deposit_amount_cents', o.deposit_amount_cents,
        'quote_note',          o.quote_note,
        'form_responses',      o.form_responses,
        'marketplace_status',  o.marketplace_status,
        'is_paid',             o.is_paid,
        'baker_id',            p.id,
        'profile_slug',        p.profile_slug,
        'business_name',       COALESCE(NULLIF(p.business_name, ''), p.user_name, 'Your baker'),
        'items',               (
            SELECT COALESCE(json_agg(json_build_object(
                'custom_name',    oi.custom_name,
                'quantity',       oi.quantity,
                'price_per_unit', oi.price_per_unit,
                'image_menu_item_id', public.resolve_order_item_image_id(o.user_id, oi.menu_item_id, oi.custom_name)
            )), '[]'::json)
            FROM public.order_items oi
            WHERE oi.order_id = o.id AND oi.deleted_at IS NULL
        )
    ) INTO v_result
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.user_id
    WHERE o.id = p_order_id
      AND o.buyer_profile_id IS NULL
      AND o.lead_channel = 'website';

    RETURN v_result;
END;
$$;
