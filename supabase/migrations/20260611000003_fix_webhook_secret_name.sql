-- Update confirm_pickup to look for the correct vault secret name.

CREATE OR REPLACE FUNCTION confirm_pickup(p_order_id UUID, p_role TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_baker BOOLEAN;
  v_buyer BOOLEAN;
  v_both  BOOLEAN;
  v_pi_id TEXT;
  v_secret TEXT;
BEGIN
  IF p_role = 'baker' THEN
    UPDATE orders
    SET baker_pickup_confirmed = true
    WHERE id = p_order_id
      AND user_id = auth.uid()
      AND order_source = 'marketplace';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unauthorized: order not found or not owned by this baker';
    END IF;

  ELSIF p_role = 'buyer' THEN
    UPDATE orders
    SET buyer_pickup_confirmed = true
    WHERE id = p_order_id
      AND buyer_profile_id = auth.uid()
      AND baker_pickup_confirmed = true
      AND order_source = 'marketplace';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unauthorized: order not found, not owned by this buyer, or baker has not confirmed yet';
    END IF;

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

    IF v_pi_id IS NOT NULL THEN
      BEGIN
        SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets
        WHERE name = 'bakeri_webhook_secret'
        LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
        v_secret := NULL;
      END;

      IF v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/capture-payment',
          headers := jsonb_build_object(
            'Content-Type',     'application/json',
            'x-webhook-secret', v_secret
          ),
          body    := jsonb_build_object('order_id', p_order_id)
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'both_confirmed',  v_both,
    'baker_confirmed', COALESCE(v_baker, false),
    'buyer_confirmed', COALESCE(v_buyer, false)
  );
END;
$$;
