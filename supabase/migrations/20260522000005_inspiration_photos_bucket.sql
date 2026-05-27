-- ============================================================
-- Inspiration Photos bucket
-- Buyers attach inspiration photos to custom order requests.
-- Bucket is public so the baker can load photos without auth overhead.
-- UUID-based paths make them effectively private without obscuring the API.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspiration-photos',
  'inspiration-photos',
  true,
  5242880,   -- 5 MB per photo
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Buyer can upload photos for orders they placed.
-- Path format: {order_id}/photo_{n}.jpg
CREATE POLICY "buyer_insert_inspiration"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'inspiration-photos'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE id::text = (storage.foldername(name))[1]
      AND buyer_profile_id = auth.uid()
  )
);

-- Buyer and baker can delete/replace their photos.
CREATE POLICY "buyer_update_inspiration"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'inspiration-photos'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE id::text = (storage.foldername(name))[1]
      AND (buyer_profile_id = auth.uid() OR user_id = auth.uid())
  )
);
