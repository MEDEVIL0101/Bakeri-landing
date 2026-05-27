-- Update confirm_pickup to trigger capture-payment server-side when both parties confirm.
-- This ensures payment is captured even if the app goes offline after the RPC call.

CREATE OR REPLACE FUNCTION confirm_pickup(p_order_id UUID, p_role TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_baker BOOLEAN;
  v_buyer BOOLEAN;
  v_both  BOOLEAN;
  v_pi_id TEXT;
BEGIN
  IF p_role = 'baker' THEN
    UPDATE orders SET baker_pickup_confirmed = true WHERE id = p_order_id;

  ELSIF p_role = 'buyer' THEN
    UPDATE orders
    SET buyer_pickup_confirmed = true
    WHERE id = p_order_id AND baker_pickup_confirmed = true;

  ELSE
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  SELECT baker_pickup_confirmed, buyer_pickup_confirmed, payment_intent_id
  INTO v_baker, v_buyer, v_pi_id
  FROM orders WHERE id = p_order_id;

  v_both := COALESCE(v_baker, false) AND COALESCE(v_buyer, false);

  IF v_both THEN
    UPDATE orders
    SET marketplace_status = 'completed',
        status             = 'completed'
    WHERE id = p_order_id;

    -- Trigger Stripe capture server-side (async, best-effort).
    -- capture-payment only updates payment_status — it does NOT touch marketplace_status.
    IF v_pi_id IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/capture-payment',
        headers := jsonb_build_object(
          'Content-Type',     'application/json',
          'x-webhook-secret', 'fe1b0c413957b3fbe6a28f083d41a6dfcc065349f2017e668d8c46422ffcf1ca'
        ),
        body    := jsonb_build_object('order_id', p_order_id)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'both_confirmed',  v_both,
    'baker_confirmed', COALESCE(v_baker, false),
    'buyer_confirmed', COALESCE(v_buyer, false)
  );
END;
$$;
