-- ============================================================
-- Bakeri — Enable Supabase Realtime on key tables
-- Run this in Supabase Dashboard: SQL Editor → New Query
--
-- After running, also go to:
--   Database → Replication → Realtime
-- and confirm these tables appear in the publication.
-- ============================================================

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.recipes;
alter publication supabase_realtime add table public.baking_tasks;
alter publication supabase_realtime add table public.menu_items;
