-- Fix: trg_orders_guard_sensitive_columns referenced NEW.stripe_fee, but the
-- stripe_fee column was never added to the orders table. In PL/pgSQL, accessing
-- a non-existent column on NEW/OLD throws a runtime error, which caused every
-- client UPDATE to orders to fail silently (app uses try? / try?). This meant
-- no status change, paid toggle, or note edit from any device ever reached the
-- server after this trigger was deployed.

CREATE OR REPLACE FUNCTION public.orders_guard_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Service-role and postgres callers (RPCs, edge functions, admin) bypass this guard.
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Clients must not modify payment/identity fields that are managed exclusively
  -- by edge functions, RPCs, or Stripe webhooks.
  IF NEW.payment_status       IS DISTINCT FROM OLD.payment_status
     OR NEW.buyer_profile_id  IS DISTINCT FROM OLD.buyer_profile_id
     OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
     OR NEW.order_source      IS DISTINCT FROM OLD.order_source
  THEN
    RAISE EXCEPTION
      'Clients cannot modify protected order fields (payment_status, buyer_profile_id, payment_intent_id, order_source). Use the appropriate RPC or edge function.';
  END IF;

  RETURN NEW;
END;
$$;
