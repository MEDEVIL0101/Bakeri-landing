-- Advisor: public_bucket_allows_listing (2). community-images and
-- form-response-photos are both public buckets — object URL fetches
-- (/storage/v1/object/public/<bucket>/<path>) work regardless of RLS on
-- storage.objects, since that endpoint checks the bucket's public flag
-- directly. These two SELECT policies instead allow the programmatic
-- list()/download() API to enumerate every file in the bucket to anyone.
-- Confirmed no code anywhere in the app (Swift or edge functions) calls
-- .storage.from(...).list() on either bucket, so this is pure exposure
-- with no functional use — removing it doesn't change any working feature.

DROP POLICY IF EXISTS "community_images_select" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_form_response_photo" ON storage.objects;
