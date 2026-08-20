-- The 15-minute guest-order expiry (20260714000011) was sized around the old
-- immediate-capture model, where the only cost of a bad decision either way
-- was baker friction. Now that create-payment-intent holds funds instead of
-- charging them (see 20260720000001 notes), an expired guest order just
-- voids an authorization -- no Stripe fee, no refund needed -- so there's no
-- reason to run bakers so close to the wire. 45 minutes gives a realistic
-- window to notice a notification, open the app, and respond, while still
-- keeping a guest from waiting indefinitely for a baker who never shows up.

CREATE OR REPLACE FUNCTION public.expire_overdue_guest_orders()
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    UPDATE public.orders
    SET marketplace_status = 'declined', updated_at = now()
    WHERE marketplace_status = 'pending'
      AND buyer_profile_id IS NULL
      AND lead_channel = 'website'
      AND (
        (scheduled_pickup_date IS NULL AND created_at < now() - interval '45 minutes')
        OR
        (scheduled_pickup_date IS NOT NULL AND created_at < now() - interval '24 hours')
      )
    RETURNING id;
$$;
