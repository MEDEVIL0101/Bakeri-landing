-- Courses (Harvey 2026-11-06, for creators like Sheryl Cameron). A course is
-- a digital listing (menu_items.is_course) with modules and lessons; each
-- lesson is a title plus content blocks (the same blocks as product pages —
-- video, text, photos, lists, a file). Buying it enrolls the buyer: a private
-- access token gives lifetime access to every lesson, including modules
-- added later, through baker/course.html and the course-player function.
-- Lesson videos and files can live in the private course-media bucket
-- (blocks reference them as "course-media:<path>"; course-player signs them).

alter table public.menu_items add column if not exists is_course boolean not null default false;

create table if not exists public.course_modules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  title        text not null default '',
  description  text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists course_modules_item_idx on public.course_modules (menu_item_id, sort_order);

create table if not exists public.course_lessons (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  menu_item_id   uuid not null references public.menu_items(id) on delete cascade,
  module_id      uuid not null references public.course_modules(id) on delete cascade,
  title          text not null default '',
  sort_order     integer not null default 0,
  -- Free preview: anyone can watch it from the product page.
  is_preview     boolean not null default false,
  content_blocks jsonb check (content_blocks is null or jsonb_typeof(content_blocks) = 'array'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists course_lessons_module_idx on public.course_lessons (module_id, sort_order);
create index if not exists course_lessons_item_idx on public.course_lessons (menu_item_id);

create table if not exists public.course_enrollments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,   -- the vendor
  menu_item_id   uuid not null references public.menu_items(id) on delete cascade,
  email          text not null,
  name           text,
  order_id       uuid,
  source         text not null default 'purchase' check (source in ('purchase', 'manual')),
  access_token   uuid not null default gen_random_uuid() unique,
  created_at     timestamptz not null default now(),
  last_opened_at timestamptz,
  revoked_at     timestamptz
);
create unique index if not exists course_enrollments_item_email on public.course_enrollments (menu_item_id, lower(email));

create table if not exists public.course_progress (
  enrollment_id uuid not null references public.course_enrollments(id) on delete cascade,
  lesson_id     uuid not null references public.course_lessons(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  primary key (enrollment_id, lesson_id)
);

-- Vendors manage their own courses and see (and can add or revoke) their
-- own students. Students never touch these tables directly — course-player
-- (service role) checks the token.
alter table public.course_modules enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_progress enable row level security;

drop policy if exists "own course modules" on public.course_modules;
create policy "own course modules" on public.course_modules for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own course lessons" on public.course_lessons;
create policy "own course lessons" on public.course_lessons for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own course students" on public.course_enrollments;
create policy "own course students" on public.course_enrollments for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own course progress" on public.course_progress;
create policy "own course progress" on public.course_progress for select to authenticated
  using (exists (select 1 from public.course_enrollments e where e.id = enrollment_id and e.user_id = auth.uid()));

revoke all on public.course_modules, public.course_lessons, public.course_enrollments, public.course_progress from anon;
grant select, insert, update, delete on public.course_modules, public.course_lessons, public.course_enrollments to authenticated;
grant select on public.course_progress to authenticated;
grant all on public.course_modules, public.course_lessons, public.course_enrollments, public.course_progress to service_role;

-- Private bucket for lesson videos and files (up to 5 GB each), in each
-- vendor's own folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('course-media', 'course-media', false, 5368709120)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "course media owner insert" on storage.objects;
create policy "course media owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-media' and upper((storage.foldername(name))[1]) = upper(auth.uid()::text));
drop policy if exists "course media owner select" on storage.objects;
create policy "course media owner select" on storage.objects for select to authenticated
  using (bucket_id = 'course-media' and upper((storage.foldername(name))[1]) = upper(auth.uid()::text));
drop policy if exists "course media owner update" on storage.objects;
create policy "course media owner update" on storage.objects for update to authenticated
  using (bucket_id = 'course-media' and upper((storage.foldername(name))[1]) = upper(auth.uid()::text));
drop policy if exists "course media owner delete" on storage.objects;
create policy "course media owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-media' and upper((storage.foldername(name))[1]) = upper(auth.uid()::text));

-- The curriculum shown on the public product page: module and lesson
-- titles only (lesson content stays behind enrollment).
create or replace function public.get_course_outline(p_menu_item_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', m.id, 'title', m.title, 'description', m.description,
    'lessons', coalesce((select json_agg(json_build_object('id', l.id, 'title', l.title, 'is_preview', l.is_preview) order by l.sort_order, l.created_at)
                           from course_lessons l where l.module_id = m.id and l.deleted_at is null), '[]'::json)
  ) order by m.sort_order, m.created_at), '[]'::json)
  from course_modules m
  join menu_items mi on mi.id = m.menu_item_id
  where m.menu_item_id = p_menu_item_id and m.deleted_at is null
    and mi.is_course and mi.deleted_at is null and mi.is_listed_in_marketplace;
$$;
revoke all on function public.get_course_outline(uuid) from public;
grant execute on function public.get_course_outline(uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_baker_web_profile_by_id(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_profile  JSON;
    v_listings JSON;
    v_faqs     JSON;
    v_links    JSON;
BEGIN
    SELECT row_to_json(p) INTO v_profile
    FROM (
        SELECT
            id, user_name, business_name, profile_slug, bio, store_policies,
            about_story, neighbourhood, pickup_hours_json, specialty_tags,
            location, pickup_city, pickup_province, follower_count,
            selected_theme, background_pattern, is_gst_registered,
            stripe_connect_onboarding_complete, shipping_free_over_threshold,
            shipping_additional_item_percent, updated_at, storefront_listing_id,
            storefront_block_layout, storefront_design, tips_enabled,
            email_capture_heading, email_capture_body, email_capture_display_style,
            email_capture_deliverable_listing_id, header_signup_enabled, header_signup_label,
            (SELECT pr.banner_text FROM public.promotions pr
             WHERE pr.user_id = public.profiles.id AND pr.deleted_at IS NULL AND pr.is_active
               AND pr.banner_text IS NOT NULL AND btrim(pr.banner_text) <> ''
               AND COALESCE(pr.starts_at, '-infinity'::timestamptz) <= now()
               AND COALESCE(pr.ends_at,   'infinity'::timestamptz)  >  now()
             ORDER BY pr.created_at DESC LIMIT 1) AS promo_banner
        FROM public.profiles
        WHERE id = p_user_id
    ) p;

    IF v_profile IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT json_agg(l ORDER BY l.listing_kind, l.name) INTO v_listings
    FROM (
        SELECT
            m.id,
            m.name,
            m.item_description,
            m.content_blocks,
            m.is_course,
            m.category,
            m.listing_kind,
            m.allergens,
            m.lead_time_note,
            m.lead_days,
            m.shipping_fee,
            m.shipping_always_full_price,
            CASE WHEN m.marketplace_price_from > 0
                 THEN m.marketplace_price_from
                 ELSE m.default_price
            END AS price,
            (promo.ep->>'effective_price')::numeric AS sale_price,
            (promo.ep->>'original_price')::numeric  AS original_price,
            CASE WHEN promo.ep->>'promotion_id' IS NOT NULL
                 THEN jsonb_build_object(
                          'discount_type',  promo.ep->>'discount_type',
                          'discount_value', (promo.ep->>'discount_value')::numeric,
                          'label',          promo.ep->>'label')
                 ELSE NULL
            END AS promo,
            m.available_qty_today,
            m.unit,
            m.intake_form_id,
            m.storefront_intro_title,
            m.storefront_intro_body,
            m.is_storefront_form,
            m.use_drop_date,
            m.preorder_drop_date,
            m.max_preorder_quantity,
            m.tax_category,
            m.unit_weight_grams,
            m.is_assorted_box,
            m.has_variants,
            (SELECT json_agg(t ORDER BY t.sort_order) FROM (
                SELECT id, label, unit_count, price, sort_order
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image, sort_order
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants,
            (SELECT json_agg(o ORDER BY o.sort_order) FROM (
                SELECT id, label, price, stock_qty, has_image, sort_order
                FROM public.listing_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) o) AS listing_variants
        FROM public.menu_items m
        LEFT JOIN LATERAL (
            SELECT public.effective_unit_price(
                m.user_id, m.listing_kind, m.id,
                (CASE WHEN m.marketplace_price_from > 0
                      THEN m.marketplace_price_from
                      ELSE m.default_price END)::numeric,
                NULL::text
            ) AS ep
        ) promo ON true
        WHERE m.user_id = p_user_id
          AND m.is_listed_in_marketplace = true
          AND (
              auth.uid() = m.user_id
              -- A custom-order request takes no payment (quotes are paid
              -- later, and sending one needs Direct Deposit), so request
              -- forms show without Stripe connected.
              OR m.listing_kind = 'custom'
              OR EXISTS (
                  SELECT 1 FROM public.profiles sp
                  WHERE sp.id = m.user_id
                    AND (
                        sp.stripe_connect_onboarding_complete
                        OR sp.vendor_setup_completed_at IS NULL
                        OR sp.vendor_setup_completed_at <= '2026-09-23 00:00:00+00'
                    )
              )
          )
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = p_user_id AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT bl.id, bl.section, bl.label, bl.url, bl.sort_order,
               bl.style, bl.image_url, bl.outline_style, bl.shake,
               bl.target_type, bl.linked_listing_id,
               bl.subtitle, bl.button_label,
               tgt.name AS target_listing_name,
               tgt.is_lead_magnet AS target_listing_is_lead_magnet,
               tgt.item_description AS target_listing_description
        FROM public.baker_links bl
        LEFT JOIN public.menu_items tgt
               ON tgt.id = bl.linked_listing_id AND tgt.user_id = p_user_id
        WHERE bl.user_id = p_user_id AND bl.deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_baker_web_profile_by_slug(p_slug text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_profile  JSON;
    v_listings JSON;
    v_faqs     JSON;
    v_links    JSON;
BEGIN
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE profile_slug = LOWER(TRIM(p_slug))
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT row_to_json(p) INTO v_profile
    FROM (
        SELECT
            id, user_name, business_name, profile_slug, bio, store_policies,
            about_story, neighbourhood, pickup_hours_json, specialty_tags,
            location, pickup_city, pickup_province, follower_count,
            selected_theme, background_pattern, is_gst_registered,
            stripe_connect_onboarding_complete, shipping_free_over_threshold,
            shipping_additional_item_percent, updated_at, storefront_listing_id,
            storefront_block_layout, storefront_design, tips_enabled,
            email_capture_heading, email_capture_body, email_capture_display_style,
            email_capture_deliverable_listing_id, header_signup_enabled, header_signup_label,
            (SELECT pr.banner_text FROM public.promotions pr
             WHERE pr.user_id = public.profiles.id AND pr.deleted_at IS NULL AND pr.is_active
               AND pr.banner_text IS NOT NULL AND btrim(pr.banner_text) <> ''
               AND COALESCE(pr.starts_at, '-infinity'::timestamptz) <= now()
               AND COALESCE(pr.ends_at,   'infinity'::timestamptz)  >  now()
             ORDER BY pr.created_at DESC LIMIT 1) AS promo_banner
        FROM public.profiles
        WHERE id = v_user_id
    ) p;

    SELECT json_agg(l ORDER BY l.listing_kind, l.name) INTO v_listings
    FROM (
        SELECT
            m.id,
            m.name,
            m.item_description,
            m.content_blocks,
            m.is_course,
            m.category,
            m.listing_kind,
            m.allergens,
            m.lead_time_note,
            m.lead_days,
            m.shipping_fee,
            m.shipping_always_full_price,
            CASE WHEN m.marketplace_price_from > 0
                 THEN m.marketplace_price_from
                 ELSE m.default_price
            END AS price,
            (promo.ep->>'effective_price')::numeric AS sale_price,
            (promo.ep->>'original_price')::numeric  AS original_price,
            CASE WHEN promo.ep->>'promotion_id' IS NOT NULL
                 THEN jsonb_build_object(
                          'discount_type',  promo.ep->>'discount_type',
                          'discount_value', (promo.ep->>'discount_value')::numeric,
                          'label',          promo.ep->>'label')
                 ELSE NULL
            END AS promo,
            m.available_qty_today,
            m.unit,
            m.intake_form_id,
            m.storefront_intro_title,
            m.storefront_intro_body,
            m.is_storefront_form,
            m.use_drop_date,
            m.preorder_drop_date,
            m.max_preorder_quantity,
            m.tax_category,
            m.unit_weight_grams,
            m.is_assorted_box,
            m.has_variants,
            (SELECT json_agg(t ORDER BY t.sort_order) FROM (
                SELECT id, label, unit_count, price, sort_order
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image, sort_order
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants,
            (SELECT json_agg(o ORDER BY o.sort_order) FROM (
                SELECT id, label, price, stock_qty, has_image, sort_order
                FROM public.listing_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) o) AS listing_variants
        FROM public.menu_items m
        LEFT JOIN LATERAL (
            SELECT public.effective_unit_price(
                m.user_id, m.listing_kind, m.id,
                (CASE WHEN m.marketplace_price_from > 0
                      THEN m.marketplace_price_from
                      ELSE m.default_price END)::numeric,
                NULL::text
            ) AS ep
        ) promo ON true
        WHERE m.user_id = v_user_id
          AND m.is_listed_in_marketplace = true
          AND (
              auth.uid() = m.user_id
              -- A custom-order request takes no payment (quotes are paid
              -- later, and sending one needs Direct Deposit), so request
              -- forms show without Stripe connected.
              OR m.listing_kind = 'custom'
              OR EXISTS (
                  SELECT 1 FROM public.profiles sp
                  WHERE sp.id = m.user_id
                    AND (
                        sp.stripe_connect_onboarding_complete
                        OR sp.vendor_setup_completed_at IS NULL
                        OR sp.vendor_setup_completed_at <= '2026-09-23 00:00:00+00'
                    )
              )
          )
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = v_user_id AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT bl.id, bl.section, bl.label, bl.url, bl.sort_order,
               bl.style, bl.image_url, bl.outline_style, bl.shake,
               bl.target_type, bl.linked_listing_id,
               bl.subtitle, bl.button_label,
               tgt.name AS target_listing_name,
               tgt.is_lead_magnet AS target_listing_is_lead_magnet,
               tgt.item_description AS target_listing_description
        FROM public.baker_links bl
        LEFT JOIN public.menu_items tgt
               ON tgt.id = bl.linked_listing_id AND tgt.user_id = v_user_id
        WHERE bl.user_id = v_user_id AND bl.deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
    );
END;
$function$;
