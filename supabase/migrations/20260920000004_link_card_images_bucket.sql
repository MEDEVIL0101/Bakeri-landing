-- Storage bucket for the new photoCard/richCard link styles (see
-- 20260920000003) — public read (rendered on the public storefront, same
-- as storefront-headers), baker-scoped write via the {user_id}/... folder
-- convention already used by every other per-baker bucket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'link-card-images',
  'link-card-images',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "baker_manage_own_link_card_images"
ON storage.objects FOR ALL
USING (
  bucket_id = 'link-card-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'link-card-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);
