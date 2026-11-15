-- Acquisition (Harvey 2026-11-15): sign-ups are completed sign-ups (plan
-- started), not accounts created. 'abandoned' = abandoned sign-ups that week.

CREATE OR REPLACE FUNCTION public.admin_acquisition_weekly(p_weeks integer DEFAULT 12)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  with weeks as (
    select generate_series(date_trunc('week', now()) - make_interval(weeks => greatest(p_weeks, 1) - 1),
                           date_trunc('week', now()), interval '1 week') as wk
  ),
  site as (select * from site_events where path not like '/app/%' or event <> 'page_view'),
  creators as (select id, created_at from crm_prospects c where fit <> 'tools' and (c.user_id is null or not exists (select 1 from public.admin_team_accounts t where t.user_id = c.user_id))),
  first_checkout as (
    select user_id, min(created_at) as at from orders
     where deleted_at is null and (payment_intent_id is not null or deposit_payment_intent_id is not null)
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = orders.user_id)
     group by user_id
  ),
  real_users as (
    select id, created_at from auth.users
     where email not ilike '%@bakeriapp.com' and email <> 'thebakeriapp@gmail.com'
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = auth.users.id)
  )
  select coalesce(json_agg(json_build_object(
    'week', to_char(w.wk, 'YYYY-MM-DD'),
    'creators_added', (select count(*) from creators c where c.created_at >= w.wk and c.created_at < w.wk + interval '1 week'),
    'contacted', (select count(distinct a.prospect_id) from crm_activities a join creators c on c.id = a.prospect_id
                   where a.kind = 'email' and a.created_at >= w.wk and a.created_at < w.wk + interval '1 week'),
    'replied', (select count(distinct a.prospect_id) from crm_activities a join creators c on c.id = a.prospect_id
                 where a.kind = 'stage' and a.body like '%→ Replied%' and a.created_at >= w.wk and a.created_at < w.wk + interval '1 week'),
    'site_visitors', (select count(distinct visitor) from site s where s.event = 'page_view' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'signup_views', (select count(distinct visitor) from site s where s.event = 'signup_view' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'signups', (select count(*) from vendor_plans v
                 where coalesce(v.trial_used_at, v.first_paid_at) >= w.wk and coalesce(v.trial_used_at, v.first_paid_at) < w.wk + interval '1 week'
                   and not admin_is_internal(v.user_id)),
    'abandoned', jsonb_array_length(admin_drill('users', w.wk, w.wk + interval '1 week', 'abandoned')),
    'plan_views', (select count(distinct visitor) from site s where s.event = 'plan_view' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'checkout_starts', (select count(distinct visitor) from site s where s.event = 'checkout_start' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'trials', (select count(*) from vendor_plans v where v.trial_used_at >= w.wk and v.trial_used_at < w.wk + interval '1 week' and not exists (select 1 from public.admin_team_accounts t where t.user_id = v.user_id)),
    'paid', (select count(*) from vendor_plans v where v.first_paid_at >= w.wk and v.first_paid_at < w.wk + interval '1 week' and not exists (select 1 from public.admin_team_accounts t where t.user_id = v.user_id)),
    'first_checkout_sales', (select count(*) from first_checkout f where f.at >= w.wk and f.at < w.wk + interval '1 week')
  ) order by w.wk), '[]'::json)
  from weeks w;
$function$
;
