-- How a course/club's member page looks (Harvey 2026-11-07): set in the
-- builder's Community tab, read by course-player for baker/course.html.
--   { cover_url, accent, background, community_name, welcome_title,
--     welcome_body, rules }  — every key optional.
alter table public.menu_items
  add column if not exists space_design jsonb check (space_design is null or jsonb_typeof(space_design) = 'object');
