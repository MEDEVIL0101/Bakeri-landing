-- confirm_pickup RPC
-- Called by baker (role='baker') first, then buyer (role='buyer').
-- Buyer confirm is gated: only counts if baker has already confirmed.
-- When both confirmed: sets marketplace_status='completed', status='completed'.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS baker_pickup_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buyer_pickup_confirmed  BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION confirm_pickup(p_order_id UUID, p_role TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_baker BOOLEAN;
  v_buyer BOOLEAN;
  v_both  BOOLEAN;
BEGIN
  IF p_role = 'baker' THEN
    UPDATE orders SET baker_pickup_confirmed = true WHERE id = p_order_id;

  ELSIF p_role = 'buyer' THEN
    -- Sequential: buyer can only confirm after baker has
    UPDATE orders
    SET buyer_pickup_confirmed = true
    WHERE id = p_order_id AND baker_pickup_confirmed = true;

  ELSE
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  SELECT baker_pickup_confirmed, buyer_pickup_confirmed
  INTO v_baker, v_buyer
  FROM orders WHERE id = p_order_id;

  v_both := COALESCE(v_baker, false) AND COALESCE(v_buyer, false);

  IF v_both THEN
    UPDATE orders
    SET marketplace_status = 'completed',
        status             = 'completed'
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'both_confirmed',  v_both,
    'baker_confirmed', COALESCE(v_baker, false),
    'buyer_confirmed', COALESCE(v_buyer, false)
  );
END;
$$;
