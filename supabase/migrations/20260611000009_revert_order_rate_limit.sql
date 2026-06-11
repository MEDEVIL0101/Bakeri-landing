-- Revert order creation limit back to 10 per hour.
-- The 4/hour tightening was applied in error; that limit applies to sign-ups (Dashboard setting).

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
    ) < 10
);
