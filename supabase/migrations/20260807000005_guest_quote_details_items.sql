-- baker/pay-quote.html is being restyled (2026-08-07) to match the new
-- quote/invoice/receipt email design, which shows the item alongside its
-- photo — but get_guest_quote_details never returned order_items at all, so
-- the page had no item name/price to show beyond the bare order_name. Adds
-- an `items` array (custom_name, quantity, price_per_unit, menu_item_id) so
-- the page can render the same item-row shape as the emails.

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
                'menu_item_id',   oi.menu_item_id
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
