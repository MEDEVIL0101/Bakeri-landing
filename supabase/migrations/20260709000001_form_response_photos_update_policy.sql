-- The form-response-photos upload uses upsert:true, which Supabase Storage
-- evaluates against the UPDATE policy (in case the path already exists) as
-- well as INSERT. Only an INSERT policy was created in the original
-- migration, so every upload was silently rejected by RLS. Mirrors the
-- buyer_update_inspiration policy on the inspiration-photos bucket.

CREATE POLICY "buyer_update_form_response_photo"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'form-response-photos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);
