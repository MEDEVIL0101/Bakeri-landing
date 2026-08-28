-- Digital marketplace sales were showing up in the baker app as pickup orders
-- ("Ready for Pickup", pickup-time editor). See SUPPORT_LOG 2026-08-28.
--
-- Root cause is client-side: a baker whose app build predates the
-- FulfillmentType.digital enum case pulls a digital order, SyncService's
-- `FulfillmentType(rawValue: "Digital") ?? .pickup` fallback relabels it
-- locally, and the next sync push writes "Pickup" back to the server. The
-- Swift enum was fixed on 2026-08-24 but old builds keep doing this until
-- every baker updates. finalize-guest-digital-order / -digital-physical-order
-- insert `fulfillment_type = 'Digital'` correctly; nothing legitimately
-- changes it afterward for a marketplace order.
--
-- Two parts:
--   1. Backfill: reset the orders already corrupted (identified by their line
--      items resolving to one of the baker's own digital listings).
--   2. Guard: a marketplace order's fulfillment_type becomes immutable to
--      client updates. Done as a silent coerce-back in the existing
--      orders_sync_conflict_resolution BEFORE-UPDATE trigger (not a RAISE) so
--      an old-build sync push still applies its other field changes — only
--      fulfillment_type refuses to move. Edge functions / RPCs (service_role,
--      postgres) are unaffected and INSERT is not touched.

-- ---------------------------------------------------------------------------
-- 1. Backfill
-- ---------------------------------------------------------------------------
UPDATE public.orders o
SET fulfillment_type = 'Digital',
    updated_at = now()
WHERE o.order_source = 'marketplace'
  AND o.fulfillment_type IS DISTINCT FROM 'Digital'
  AND EXISTS (
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
  );

-- ---------------------------------------------------------------------------
-- 2. Guard: fulfillment_type is immutable to clients on marketplace orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_sync_conflict_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Service-role / postgres writes bypass all conflict logic.
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Reject stale writes: the incoming updated_at is older than what the server
  -- already has, meaning a fresher update from another device arrived first.
  IF NEW.updated_at < OLD.updated_at THEN
    RETURN NULL;   -- silently skip; the other trigger (guard) won't fire either
  END IF;

  -- A marketplace order's fulfillment_type is set once by the edge function
  -- that created it and is never a client's to change. An old app build that
  -- can't represent 'Digital' locally would otherwise sync 'Pickup' back over
  -- it — silently hold the server's value instead of failing the whole update.
  IF OLD.order_source = 'marketplace'
     AND NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
  THEN
    NEW.fulfillment_type := OLD.fulfillment_type;
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
