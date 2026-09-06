-- Storefront (order_source='marketplace') orders keep getting their
-- classification / lifecycle fields corrupted by client sync pushes from
-- baker app builds that can't represent the value locally. History:
--   * 2026-08-05  claim_invoice RPCs flipped order_source manual->marketplace
--                 (fixed: 20260805000003, RPCs no longer touch it)
--   * 2026-08-28  old builds synced fulfillment_type 'Digital'->'Pickup'
--                 (fixed: 20260828000001, coerce-back on marketplace rows)
--   * 2026-09-06  order #283482 / whitneyr44@yahoo.com — a digital storefront
--                 sale, correct on the server as marketplace/Digital, but
--                 marketplace_status had been synced 'completed'->'ready_for_pickup'
--                 by the baker's app, so it rendered as a baked-goods pickup
--                 order (Confirmed/Baked/Decorated/Packaged stepper, a due
--                 time) and the digital-download tools never appeared.
--
-- There are only two kinds of order: manual (baker-entered) and storefront
-- (guest checkout on the website, order_source='marketplace'). A storefront
-- order's order_source, lead_channel and — once it reaches a terminal state —
-- marketplace_status are set by the edge functions / RPCs that own its
-- lifecycle and are never a generic client sync's to change.
--
-- Two parts:
--   1. Backfill: repair storefront digital orders whose marketplace_status
--      drifted off 'completed'.
--   2. Guard: extend orders_sync_conflict_resolution (the existing BEFORE
--      UPDATE coerce-back trigger) so a non-service writer can no longer move
--      order_source, lead_channel, or a *terminal* marketplace_status on a
--      storefront order. Silent coerce-back (not RAISE), same as the
--      fulfillment_type rule it sits beside, so an old build's other field
--      edits still apply.

-- ---------------------------------------------------------------------------
-- 1. Backfill
-- ---------------------------------------------------------------------------
-- A digital sale has no pickup/ship steps: once the charge is captured it is
-- complete. finalize-guest-digital-order / -digital-physical-order insert
-- marketplace_status='completed' + completed_at; anything else on a captured
-- digital storefront order is drift. Terminal negatives (cancelled / refunded
-- / declined) are left alone. fulfillment_type is re-asserted to 'Digital' in
-- the same pass for rows the 2026-08-28 guard hasn't already corrected.
UPDATE public.orders o
SET marketplace_status = 'completed',
    completed_at        = COALESCE(o.completed_at, o.created_at),
    fulfillment_type    = 'Digital',
    updated_at          = now()
WHERE o.order_source = 'marketplace'
  AND o.payment_status = 'captured'
  AND o.marketplace_status IS DISTINCT FROM 'completed'
  AND (o.marketplace_status IS NULL
       OR o.marketplace_status NOT IN ('cancelled', 'refunded', 'declined'))
  AND (
    o.fulfillment_type = 'Digital'
    OR EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.menu_items mi
        ON mi.user_id = o.user_id
       AND mi.listing_kind = 'digital'
       AND mi.deleted_at IS NULL
       AND (
            oi.menu_item_id = mi.id
         OR lower(oi.custom_name) = lower(mi.name)
         OR lower(oi.custom_name) LIKE lower(mi.name) || ' %'
         OR lower(oi.custom_name) LIKE lower(mi.name) || '-%'
         OR lower(oi.custom_name) LIKE lower(mi.name) || ' | %'
       )
      WHERE oi.order_id = o.id
        AND oi.deleted_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_sync_conflict_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Service-role / postgres writes bypass all conflict logic. This covers
  -- every edge function and every SECURITY DEFINER RPC (undo_order_completion,
  -- force_complete_marketplace_order, claim_*), so the coerce-backs below only
  -- ever act on a baker app's own authenticated writes.
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Reject stale writes: the incoming updated_at is older than what the server
  -- already has, meaning a fresher update from another device arrived first.
  IF NEW.updated_at < OLD.updated_at THEN
    RETURN NULL;   -- silently skip; the other trigger (guard) won't fire either
  END IF;

  -- order_source is decided once, at creation, and is immutable to clients
  -- forever (see 20260805000003). Hold it silently rather than letting the
  -- separate trg_orders_guard_sensitive_columns RAISE and drop the whole push.
  IF NEW.order_source IS DISTINCT FROM OLD.order_source THEN
    NEW.order_source := OLD.order_source;
  END IF;

  IF OLD.order_source = 'marketplace' THEN
    -- lead_channel is a pure classification field set by the creating edge
    -- function; no baker flow changes it.
    IF NEW.lead_channel IS DISTINCT FROM OLD.lead_channel THEN
      NEW.lead_channel := OLD.lead_channel;
    END IF;

    -- fulfillment_type on a storefront order is the edge function's to set.
    -- An old build that can't represent 'Digital' locally would otherwise
    -- sync 'Pickup' back over it (SUPPORT_LOG 2026-08-28).
    IF NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type THEN
      NEW.fulfillment_type := OLD.fulfillment_type;
    END IF;

    -- A terminal marketplace_status is sticky against client writes. Forward
    -- transitions (pending -> confirmed -> ready_for_pickup -> ...) still work
    -- because OLD is non-terminal; the only ways out of a terminal state are
    -- undo_order_completion / force_complete_marketplace_order / cancel-order,
    -- all of which run as postgres/service_role and bypassed above.
    -- This is what stopped #283482 from sliding 'completed' -> 'ready_for_pickup'.
    IF OLD.marketplace_status IN ('completed', 'cancelled', 'refunded', 'declined')
       AND NEW.marketplace_status IS DISTINCT FROM OLD.marketplace_status
    THEN
      NEW.marketplace_status := OLD.marketplace_status;
    END IF;
  END IF;

  -- When a user-visible field actually changed, stamp the server's authoritative
  -- time so the other device's delta sync (gte updated_at >= since) finds this row
  -- even if the writing device's clock lags by a few seconds.
  IF NEW.status             IS DISTINCT FROM OLD.status
     OR NEW.is_paid         IS DISTINCT FROM OLD.is_paid
     OR NEW.paid_at         IS DISTINCT FROM OLD.paid_at
     OR NEW.order_name      IS DISTINCT FROM OLD.order_name
     OR NEW.customer_name   IS DISTINCT FROM OLD.customer_name
     OR NEW.due_date        IS DISTINCT FROM OLD.due_date
     OR NEW.notes           IS DISTINCT FROM OLD.notes
     OR NEW.fulfillment_type   IS DISTINCT FROM OLD.fulfillment_type
     OR NEW.delivery_details   IS DISTINCT FROM OLD.delivery_details
     OR NEW.deposit_amount     IS DISTINCT FROM OLD.deposit_amount
     OR NEW.deposit_paid_at    IS DISTINCT FROM OLD.deposit_paid_at
     OR NEW.payment_note       IS DISTINCT FROM OLD.payment_note
     OR NEW.color_name         IS DISTINCT FROM OLD.color_name
     OR NEW.start_date         IS DISTINCT FROM OLD.start_date
     OR NEW.marketplace_status IS DISTINCT FROM OLD.marketplace_status
  THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;
