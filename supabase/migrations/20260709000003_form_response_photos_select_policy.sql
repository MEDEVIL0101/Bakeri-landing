-- Upsert uploads (FileOptions(upsert: true)) make Storage do an internal
-- existence check against storage.objects before deciding insert vs update —
-- that check is itself RLS-gated. Without a SELECT policy the check itself
-- gets rejected, surfacing as the same generic "row violates row-level
-- security policy" error even though INSERT/UPDATE are correctly configured.
-- Mirrors authenticated_read_inspiration on the sibling inspiration-photos
-- bucket, which has all three (SELECT/INSERT/UPDATE) policies.

CREATE POLICY "authenticated_read_form_response_photo"
ON storage.objects FOR SELECT
USING (bucket_id = 'form-response-photos');
