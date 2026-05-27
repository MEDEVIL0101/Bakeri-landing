-- Allow authenticated users to read inspiration photos.
-- Bakers need to download photos uploaded by buyers for quote requests.
-- The bucket is public so unauthenticated public-URL access also works,
-- but the iOS SDK's download() method requires an explicit SELECT policy.

CREATE POLICY "authenticated_read_inspiration"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'inspiration-photos');
