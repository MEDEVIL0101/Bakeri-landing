-- Adds pickup confirmation tracking and completed status to marketplace orders.
-- Both buyer and baker must confirm pickup before payment is processed.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS buyer_pickup_confirmed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS baker_pickup_confirmed boolean NOT NULL DEFAULT false;

-- RPC: called by either buyer or baker to confirm their side of the pickup.
-- Returns { both_confirmed: true } when both parties have confirmed.
CREATE OR REPLACE FUNCTION confirm_pickup(p_order_id UUID, p_role TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_buyer_confirmed boolean;
  v_baker_confirmed boolean;
BEGIN
  IF p_role = 'buyer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM orders WHERE id = p_order_id AND buyer_profile_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    UPDATE orders
    SET buyer_pickup_confirmed = true, updated_at = NOW()
    WHERE id = p_order_id;

  ELSIF p_role = 'baker' THEN
    IF NOT EXISTS (
      SELECT 1 FROM orders WHERE id = p_order_id AND user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    UPDATE orders
    SET baker_pickup_confirmed = true, updated_at = NOW()
    WHERE id = p_order_id;
  ELSE
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT buyer_pickup_confirmed, baker_pickup_confirmed
  INTO v_buyer_confirmed, v_baker_confirmed
  FROM orders WHERE id = p_order_id;

  IF v_buyer_confirmed AND v_baker_confirmed THEN
    UPDATE orders
    SET marketplace_status = 'completed', updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('both_confirmed', v_buyer_confirmed AND v_baker_confirmed);
END;
$$;
