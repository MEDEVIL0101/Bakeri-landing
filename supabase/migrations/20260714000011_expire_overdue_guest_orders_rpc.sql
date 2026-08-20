-- Atomic UPDATE for the guest-order timeout sweep. A single SQL statement,
-- not a SELECT-then-UPDATE, so a baker accepting an order at the same
-- moment the sweep runs can't race it — the WHERE clause on
-- marketplace_status = 'pending' simply won't match once they've accepted.
-- Called by expire-overdue-guest-orders (service role) rather than
-- constructing this compound OR-of-date-conditions through PostgREST's
-- filter syntax.

CREATE OR REPLACE FUNCTION public.expire_overdue_guest_orders()
RETURNS TABLE(id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.orders
    SET marketplace_status = 'declined', updated_at = now()
    WHERE marketplace_status = 'pending'
      AND buyer_profile_id IS NULL
      AND lead_channel = 'website'
      AND (
        (scheduled_pickup_date IS NULL AND created_at < now() - interval '15 minutes')
        OR
        (scheduled_pickup_date IS NOT NULL AND created_at < now() - interval '24 hours')
      )
    RETURNING id;
$$;

REVOKE ALL ON FUNCTION public.expire_overdue_guest_orders() FROM PUBLIC;
