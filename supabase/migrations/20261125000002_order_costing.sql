-- Order costing (Harvey's notes 2026-11-25):
--  * an order line can use several recipes (e.g. the cookie + the icing):
--    order_items.recipe_ids, like menu_items.recipe_ids. recipe_id stays as
--    the first one for older app builds.
--  * what the baker makes on an order after paying themselves:
--    orders.labor_minutes (time spent on it; null = not entered) and
--    profiles.hourly_wage (their rate; null = not set). Private: the public
--    storefront RPCs select profile columns by name and don't include it.
alter table public.order_items add column if not exists recipe_ids uuid[] not null default '{}';
update public.order_items set recipe_ids = array[recipe_id]
  where recipe_id is not null and recipe_ids = '{}';
alter table public.orders add column if not exists labor_minutes integer
  check (labor_minutes is null or labor_minutes >= 0);
alter table public.profiles add column if not exists hourly_wage numeric(10,2)
  check (hourly_wage is null or hourly_wage >= 0);
