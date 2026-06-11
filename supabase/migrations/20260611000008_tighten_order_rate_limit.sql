-- Tighten buyer order creation to 4 per hour (down from 10).
-- A legitimate buyer placing multiple quote requests in an hour is rare;
-- 4 is sufficient for normal use and significantly limits spam targeting bakers.

DROP POLICY IF EXISTS "marketplace_buyer_create_order" ON public.orders;
CREATE POLICY "marketplace_buyer_create_order"
ON public.orders
FOR INSERT
WITH CHECK (
    order_source = 'marketplace'
    AND marketplace_status = 'pending_quote'
    AND buyer_profile_id = auth.uid()
    AND payment_intent_id IS NULL
    AND (
        SELECT COUNT(*)
        FROM public.orders
        WHERE buyer_profile_id = auth.uid()
          AND order_source = 'marketplace'
          AND created_at > NOW() - INTERVAL '1 hour'
    ) < 4
);
