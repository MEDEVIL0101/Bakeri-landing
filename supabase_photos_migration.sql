-- ============================================================
-- Bakeri — Photos Storage Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase_migration.sql if setting up fresh.
-- ============================================================

-- ── Order Photos Bucket ───────────────────────────────────────
-- Creates a private storage bucket for order inspiration photos.
-- Path structure: {user_id}/{order_id}/photo_{n}.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-photos',
  'order-photos',
  false,
  10485760,   -- 10 MB max per file
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- RLS: each user can only access photos under their own user_id folder.
create policy "order_photos_insert" on storage.objects
  for insert with check (
    bucket_id = 'order-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "order_photos_select" on storage.objects
  for select using (
    bucket_id = 'order-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "order_photos_update" on storage.objects
  for update using (
    bucket_id = 'order-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "order_photos_delete" on storage.objects
  for delete using (
    bucket_id = 'order-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Business Logos Bucket ────────────────────────────────────
-- One logo per user. Path: {user_id}/logo.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-logos',
  'business-logos',
  false,
  5242880,   -- 5 MB max
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "business_logos_insert" on storage.objects
  for insert with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "business_logos_select" on storage.objects
  for select using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "business_logos_update" on storage.objects
  for update using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "business_logos_delete" on storage.objects
  for delete using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Orders Table — Photo Count Column ────────────────────────
-- Tracks how many photos are stored in the bucket for each order,
-- so other devices know whether to attempt a download on first sync.
alter table public.orders
  add column if not exists reference_photo_count integer not null default 0;
