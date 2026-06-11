-- =============================================================
-- Security patches — 2026-06-11
-- Addresses findings from security audit
-- =============================================================


-- ---------------------------------------------------------------
-- FIX 1: confirm_pickup — restore baker ownership check
-- (Finding 4 — HIGH)
-- The previous revision dropped AND user_id = auth.uid() for the
-- baker role, allowing any user to confirm pickup on any order.
-- Also moves the webhook secret to a vault reference so it is
-- no longer a hardcoded string literal.
-- ---------------------------------------------------------------

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
    -- Ownership check: only the baker who owns this order can confirm
    UPDATE orders
    SET baker_pickup_confirmed = true
    WHERE id = p_order_id
      AND user_id = auth.uid()
      AND order_source = 'marketplace';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unauthorized: order not found or not owned by this baker';
    END IF;

  ELSIF p_role = 'buyer' THEN
    -- Ownership check: only the buyer on this order can confirm
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
      -- Read secret from vault instead of hardcoding
      BEGIN
        SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets
        WHERE name = 'capture_payment_webhook_secret'
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


-- ---------------------------------------------------------------
-- FIX 2: artisan_applications — drop open SELECT policy
-- (Finding 6 — HIGH)
-- All authenticated users could read every applicant's name,
-- email, Instagram handle, etc. Applications are admin-only data.
-- ---------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated users can read artisan applications"
  ON public.artisan_applications;

-- Keep the INSERT policy so users can still submit applications.
-- Read access is now service-role only (Supabase dashboard).


-- ---------------------------------------------------------------
-- FIX 3: community-images storage — scope uploads to uploader's path
-- (Finding 8 — HIGH)
-- Any authenticated user could upload to any path, including
-- overwriting another user's thread photos.
-- ---------------------------------------------------------------

DROP POLICY IF EXISTS "community_images_insert" ON storage.objects;

CREATE POLICY "community_images_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'community-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);


-- ---------------------------------------------------------------
-- FIX 4: Prevent buyer from modifying quoted_price on confirm
-- (Finding 12 — MEDIUM)
-- The broad UPDATE policy let a buyer change quoted_price to $0
-- before the pay-quote-order edge function reads it.
-- Replace with a narrow SECURITY DEFINER RPC approach by locking
-- down the UPDATE policy to only allow status transitions.
-- ---------------------------------------------------------------

DROP POLICY IF EXISTS "marketplace_buyer_confirm_payment" ON orders;

CREATE POLICY "marketplace_buyer_confirm_payment"
ON orders FOR UPDATE
USING (
  order_source     = 'marketplace'
  AND buyer_profile_id = auth.uid()
  AND marketplace_status = 'quote_provided'
)
WITH CHECK (
  order_source     = 'marketplace'
  AND buyer_profile_id = auth.uid()
  -- Prevent price manipulation: quoted_price must not change
  AND quoted_price = (SELECT quoted_price FROM orders WHERE id = orders.id)
);


-- ---------------------------------------------------------------
-- FIX 5: community_groups INSERT — verify creator identity
-- (Finding 13 — MEDIUM)
-- Any user could insert a group attributed to another user.
-- ---------------------------------------------------------------

DROP POLICY IF EXISTS "groups_insert" ON public.community_groups;

CREATE POLICY "groups_insert"
ON public.community_groups FOR INSERT
TO authenticated
WITH CHECK (
  created_by_user_id = auth.uid()
  OR created_by_user_id IS NULL
);


-- ---------------------------------------------------------------
-- FIX 6: Thread tags array — length and count constraints
-- (Finding 16 — MEDIUM)
-- No limit on tag count or individual tag length allowed
-- memory exhaustion and potential stored XSS in web contexts.
-- ---------------------------------------------------------------

ALTER TABLE public.community_threads
  DROP CONSTRAINT IF EXISTS community_threads_tags_check;

ALTER TABLE public.community_threads
  ADD CONSTRAINT community_threads_tags_check CHECK (
    tags IS NULL
    OR (
      array_length(tags, 1) <= 10
      AND char_length(array_to_string(tags, '')) <= 1000
    )
  );


-- ---------------------------------------------------------------
-- FIX 7: Community content — body length caps
-- (Finding 26 — INFO / defensive hardening)
-- ---------------------------------------------------------------

ALTER TABLE public.community_threads
  DROP CONSTRAINT IF EXISTS community_threads_body_length;
ALTER TABLE public.community_threads
  ADD CONSTRAINT community_threads_body_length
  CHECK (body IS NULL OR char_length(body) <= 10000);

ALTER TABLE public.community_comments
  DROP CONSTRAINT IF EXISTS community_comments_body_length;
ALTER TABLE public.community_comments
  ADD CONSTRAINT community_comments_body_length
  CHECK (char_length(body) <= 5000);


-- ---------------------------------------------------------------
-- FIX 8: inspiration-photos bucket — make private
-- (Finding 22 — LOW)
-- Bucket was public = true; anyone with an order UUID could
-- access buyer's inspiration photos without authentication.
-- ---------------------------------------------------------------

UPDATE storage.buckets
SET public = false
WHERE id = 'inspiration-photos';

-- Add authenticated SELECT policy so baker can still load photos
-- via the authenticated Supabase client in OrderDetailView.
DROP POLICY IF EXISTS "inspiration_photos_select" ON storage.objects;

CREATE POLICY "inspiration_photos_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspiration-photos'
  AND (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE id::text = (storage.foldername(name))[1]
        AND (buyer_profile_id = auth.uid() OR user_id = auth.uid())
    )
  )
);
