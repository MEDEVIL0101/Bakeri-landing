-- pay-quote.html only ever showed the bare quoted total, never what the
-- quote was actually for — the same "what you requested" itemized answers
-- send-guest-quote-email already renders from orders.form_responses. Adds
-- that column to get_guest_quote_details so the payment page can show the
-- full record, not just a number.

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
        'order_id',           o.id,
        'order_name',         o.order_name,
        'customer_name',      o.customer_name,
        'quoted_price',       o.quoted_price,
        'quote_note',         o.quote_note,
        'form_responses',     o.form_responses,
        'marketplace_status', o.marketplace_status,
        'is_paid',            o.is_paid,
        'baker_id',           p.id,
        'profile_slug',       p.profile_slug,
        'business_name',      COALESCE(NULLIF(p.business_name, ''), p.user_name, 'Your baker')
    ) INTO v_result
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.user_id
    WHERE o.id = p_order_id
      AND o.buyer_profile_id IS NULL
      AND o.lead_channel = 'website';

    RETURN v_result;
END;
$$;
