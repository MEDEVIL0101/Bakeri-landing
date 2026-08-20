-- Notify buyer when baker confirms handoff (baker_pickup_confirmed flips true).
-- The existing trigger only watches marketplace_status; it misses this column change.
-- This gives the buyer the prompt to open their order and confirm receipt.

CREATE OR REPLACE FUNCTION trg_fn_baker_pickup_confirmed_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_buyer_id UUID := NEW.buyer_profile_id;
  v_name     TEXT := COALESCE(NEW.order_name, 'your order');
  v_baker_nm TEXT := COALESCE(NEW.baker_display_name, 'Your baker');
BEGIN
  -- Fire only when baker_pickup_confirmed flips from false/null → true
  IF (OLD.baker_pickup_confirmed IS DISTINCT FROM TRUE)
     AND NEW.baker_pickup_confirmed = TRUE
     AND NEW.order_source = 'marketplace'
     AND v_buyer_id IS NOT NULL
  THEN
    PERFORM send_marketplace_notification(
      v_buyer_id,
      '🤝 Handoff Ready',
      v_baker_nm || ' has handed off ' || v_name || ' — tap to confirm receipt',
      jsonb_build_object('type', 'baker_confirmed_pickup', 'order_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_baker_pickup_confirmed_notify ON orders;
CREATE TRIGGER trg_baker_pickup_confirmed_notify
AFTER UPDATE OF baker_pickup_confirmed ON orders
FOR EACH ROW EXECUTE FUNCTION trg_fn_baker_pickup_confirmed_notify();
