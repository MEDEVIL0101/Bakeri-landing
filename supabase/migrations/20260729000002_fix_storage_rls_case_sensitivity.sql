-- Hotfix: every storage.objects RLS policy that checks a folder name against
-- auth.uid() (or another UUID column) was comparing them as exact-match
-- text — but Swift's UUID string interpolation (used everywhere the app
-- builds an upload path, e.g. "\(userID)/header.jpg") renders UUIDs
-- UPPERCASE, while Postgres's auth.uid()::text (and any other ::text cast
-- of a uuid column) renders lowercase. Exact string equality between the
-- two silently fails every time, so every affected upload has been getting
-- rejected with "new row violates row-level security policy" since the
-- day each of these was introduced. Confirmed 2026-07-29 via the new
-- storefront header-image upload throwing exactly that error.
--
-- Fix: compare both sides case-insensitively (UPPER on both), which is
-- correct regardless of which convention any given client uses and doesn't
-- weaken the actual security boundary — it only recognizes the exact same
-- already-authorized UUID under a different letter case.

-- community-images (post images)
DROP POLICY IF EXISTS "community_images_insert" ON storage.objects;
CREATE POLICY "community_images_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'community-images'
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
);

-- form-response-photos (buyer intake-form photo answers)
DROP POLICY IF EXISTS "buyer_insert_form_response_photo" ON storage.objects;
CREATE POLICY "buyer_insert_form_response_photo"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'form-response-photos'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
);

DROP POLICY IF EXISTS "buyer_update_form_response_photo" ON storage.objects;
CREATE POLICY "buyer_update_form_response_photo"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'form-response-photos'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
);

-- baker-portraits (About section photo)
DROP POLICY IF EXISTS "baker_manage_own_portrait" ON storage.objects;
CREATE POLICY "baker_manage_own_portrait"
ON storage.objects FOR ALL
USING (
  bucket_id = 'baker-portraits'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'baker-portraits'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
);

-- storefront-headers (header banner image)
DROP POLICY IF EXISTS "baker_manage_own_header" ON storage.objects;
CREATE POLICY "baker_manage_own_header"
ON storage.objects FOR ALL
USING (
  bucket_id = 'storefront-headers'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'storefront-headers'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
);

-- digital-products (private, sellable digital downloads)
DROP POLICY IF EXISTS "baker_manage_own_digital_products" ON storage.objects;
CREATE POLICY "baker_manage_own_digital_products"
ON storage.objects FOR ALL
USING (
  bucket_id = 'digital-products'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'digital-products'
  AND auth.uid() IS NOT NULL
  AND UPPER((storage.foldername(name))[1]) = UPPER(auth.uid()::text)
);

-- inspiration-photos (buyer's reference photos on a custom order)
DROP POLICY IF EXISTS "buyer_insert_inspiration" ON storage.objects;
CREATE POLICY "buyer_insert_inspiration"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'inspiration-photos'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE UPPER(id::text) = UPPER((storage.foldername(name))[1])
      AND buyer_profile_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "buyer_update_inspiration" ON storage.objects;
CREATE POLICY "buyer_update_inspiration"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'inspiration-photos'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE UPPER(id::text) = UPPER((storage.foldername(name))[1])
      AND (buyer_profile_id = auth.uid() OR user_id = auth.uid())
  )
);

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
      WHERE UPPER(id::text) = UPPER((storage.foldername(name))[1])
        AND (buyer_profile_id = auth.uid() OR user_id = auth.uid())
    )
  )
);
