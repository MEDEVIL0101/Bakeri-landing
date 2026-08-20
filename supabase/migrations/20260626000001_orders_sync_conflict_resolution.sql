-- Fix cross-device order sync: stale-write race condition.
--
-- Root cause: both devices run a 5-minute syncAll that does pull-then-push-all.
-- When two syncs overlap, whichever device's push arrives last wins — even if it
-- carries an older status. The "winning" write has an old updated_at, which then
-- falls below the other device's `since` cutoff, so the delta sync never catches up.
--
-- Two guarantees this trigger provides:
--   1. Stale writes (incoming updated_at < server's current) are silently rejected.
--      The server keeps the newer state; the rejecting device will pull it on the
--      next delta sync (since the server's timestamp is still fresh).
--   2. When a meaningful field genuinely changes, updated_at is stamped to now().
--      This ensures the other device's delta query (updated_at >= since) always
--      finds the row, even if the client's clock is slightly behind the server.
--
-- Service-role and postgres callers (RPCs, edge functions, admin) bypass both rules
-- so marketplace payment flows and admin overrides are unaffected.

CREATE OR REPLACE FUNCTION public.orders_sync_conflict_resolution()
RETURNS TRIGGER
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

-- Name starts with 'o', so it fires before trg_orders_guard_sensitive_columns.
-- A rejected stale write (RETURN NULL) never reaches the guard check.
CREATE TRIGGER orders_sync_conflict_resolution_trigger
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_sync_conflict_resolution();
