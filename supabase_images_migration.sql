-- ============================================================
-- Bakeri — Images Migration
-- Run in Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── has_image columns ────────────────────────────────────────
alter table public.recipes
  add column if not exists has_image boolean not null default false;

alter table public.menu_items
  add column if not exists has_image boolean not null default false;

alter table public.recipe_ingredients
  add column if not exists has_image boolean not null default false;

-- ── Recipe Images Bucket ──────────────────────────────────────
-- Path: {user_id}/{recipe_id}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "recipe_images_insert" on storage.objects
  for insert with check (bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recipe_images_select" on storage.objects
  for select using (bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recipe_images_update" on storage.objects
  for update using (bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recipe_images_delete" on storage.objects
  for delete using (bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Menu Item Images Bucket ───────────────────────────────────
-- Path: {user_id}/{menu_item_id}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-item-images', 'menu-item-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "menu_item_images_insert" on storage.objects
  for insert with check (bucket_id = 'menu-item-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "menu_item_images_select" on storage.objects
  for select using (bucket_id = 'menu-item-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "menu_item_images_update" on storage.objects
  for update using (bucket_id = 'menu-item-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "menu_item_images_delete" on storage.objects
  for delete using (bucket_id = 'menu-item-images'
    and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Ingredient Images Bucket ──────────────────────────────────
-- Path: {user_id}/{ingredient_id}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ingredient-images', 'ingredient-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "ingredient_images_insert" on storage.objects
  for insert with check (bucket_id = 'ingredient-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ingredient_images_select" on storage.objects
  for select using (bucket_id = 'ingredient-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ingredient_images_update" on storage.objects
  for update using (bucket_id = 'ingredient-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ingredient_images_delete" on storage.objects
  for delete using (bucket_id = 'ingredient-images'
    and (storage.foldername(name))[1] = auth.uid()::text);
