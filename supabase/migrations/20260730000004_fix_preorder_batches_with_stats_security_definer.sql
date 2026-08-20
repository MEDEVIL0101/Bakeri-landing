-- CRITICAL fix: public.preorder_batches_with_stats had no security_invoker
-- setting (Supabase Advisor flags this as "Security Definer View") AND no
-- row filter of its own — it ran as the view owner, bypassing RLS on both
-- preorder_batches and preorder_reservations entirely, with zero WHERE
-- clause. Since both `anon` and `authenticated` had SELECT on it, anyone
-- holding the public anon key (embedded in every baker's storefront HTML)
-- could query this view directly via the REST API and see EVERY baker's
-- preorder batches — including inactive/draft ones never meant to be public
-- — plus reservation-derived stats (filled_slots, buyer_count) that should
-- only be visible for batches the caller is actually allowed to see.
--
-- The legitimate use cases (confirmed by reading every real caller: iOS
-- PreOrderService.swift, Bakeri Admin/SupabaseAdminService.swift) are:
--   1. Public/any buyer: active batches only, with real-time slot stats —
--      matches preorder_batches' own existing "public read active" RLS
--      policy. This is why the view can't simply flip to plain
--      security_invoker with no other changes: preorder_reservations has NO
--      public read policy (correctly — raw reservation rows must stay
--      private), so a naive invoker view would silently zero out
--      filled_slots/buyer_count for every public caller, breaking the
--      "X slots left" feature buyers rely on to decide whether to order.
--   2. A baker: their own batches (active or not), with stats.
--   3. Bakeri Admin (service_role key): every batch, with stats.
--
-- Fix shape: the view itself becomes a normal security_invoker view, so row
-- visibility on preorder_batches naturally follows that table's own RLS
-- (service_role bypasses RLS entirely, as always). The aggregate stats are
-- computed by a separate SECURITY DEFINER function — still needed to bypass
-- preorder_reservations' RLS for the aggregate — but that function now
-- re-checks the exact same visibility rule internally, so calling it
-- directly (bypassing the view) can't be used to probe stats for a batch
-- the caller isn't otherwise allowed to see.

CREATE OR REPLACE FUNCTION public.preorder_batch_reservation_stats(p_batch_id UUID)
RETURNS TABLE(filled_slots INTEGER, buyer_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mirrors preorder_batches' own RLS ("public read active" OR "baker read
  -- own"), plus service_role (Bakeri Admin) — a caller who can't see the
  -- batch itself gets no stats for it either, whether they go through the
  -- view or call this function directly.
  IF NOT EXISTS (
    SELECT 1 FROM preorder_batches b
    WHERE b.id = p_batch_id
      AND (b.is_active = true OR b.baker_user_id = auth.uid() OR auth.role() = 'service_role')
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(sum(r.quantity) FILTER (WHERE r.payment_status = ANY (ARRAY['paid'::text, 'pending'::text])), 0::bigint)::integer,
    count(DISTINCT r.buyer_profile_id) FILTER (WHERE r.payment_status = ANY (ARRAY['paid'::text, 'pending'::text]))::integer
  FROM preorder_reservations r
  WHERE r.batch_id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preorder_batch_reservation_stats(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.preorder_batch_reservation_stats(UUID) IS 'Aggregate reservation stats for one preorder batch. SECURITY DEFINER to bypass preorder_reservations RLS for the aggregate, but re-checks the same batch-visibility rule as preorder_batches RLS internally, so it cannot be used to probe stats for a batch the caller could not otherwise see.';

CREATE OR REPLACE VIEW public.preorder_batches_with_stats
WITH (security_invoker = true) AS
SELECT
  b.id,
  b.baker_user_id,
  b.menu_item_id,
  b.title,
  b.description,
  b.unit,
  b.category,
  b.image_url,
  b.pickup_date,
  b.order_cutoff,
  b.total_slots,
  b.price_per_slot,
  b.frequency,
  b.notes,
  b.is_active,
  b.created_at,
  b.updated_at,
  COALESCE(s.filled_slots, 0) AS filled_slots,
  COALESCE(s.buyer_count, 0) AS buyer_count
FROM preorder_batches b
LEFT JOIN LATERAL public.preorder_batch_reservation_stats(b.id) s ON true;

COMMENT ON VIEW public.preorder_batches_with_stats IS 'security_invoker=true — row visibility follows preorder_batches'' own RLS (public sees active batches, a baker sees their own, service_role sees all). Stats come from the SECURITY DEFINER preorder_batch_reservation_stats(), which re-checks the same visibility rule, so this view exposes nothing beyond what a caller could already see on the base tables.';
