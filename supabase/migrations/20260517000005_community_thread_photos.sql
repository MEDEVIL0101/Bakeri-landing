-- ============================================================
-- Community thread photos + community-images storage bucket
-- ============================================================

-- Add optional photo URL to threads
ALTER TABLE public.community_threads
    ADD COLUMN IF NOT EXISTS photo_url text;

-- Create the community-images storage bucket (public read, auth write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'community-images',
    'community-images',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "community_images_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'community-images');

CREATE POLICY "community_images_select"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'community-images');

CREATE POLICY "community_images_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'community-images');
