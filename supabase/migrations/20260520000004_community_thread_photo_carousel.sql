-- Add multi-photo support to community threads (up to 3 photos, carousel)
-- Keeps legacy photo_url column for backward compat.

ALTER TABLE public.community_threads
    ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';

-- Backfill: migrate any existing single photo_url into the array
UPDATE public.community_threads
SET photo_urls = ARRAY[photo_url]
WHERE photo_url IS NOT NULL
  AND photo_url <> ''
  AND photo_urls = '{}';

-- Tighten storage delete policy: only the uploader can delete their own files
DROP POLICY IF EXISTS "community_images_delete" ON storage.objects;
CREATE POLICY "community_images_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'community-images' AND owner = auth.uid());
