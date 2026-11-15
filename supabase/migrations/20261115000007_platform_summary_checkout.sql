-- Analytics per-baker table (Harvey 2026-11-15): paid_gtv is the order value
-- actually paid through Bakerï checkout (a payment intent on the order), not
-- orders a vendor marked paid by hand. Bakerï earns nothing on the rest.
CREATE OR REPLACE FUNCTION public.admin_platform_summary_range(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(baker_user_id uuid, order_count bigint, total_gtv numeric, paid_gtv numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select o.user_id, count(distinct o.id),
           coalesce(sum(oi.price_per_unit * oi.quantity), 0),
           coalesce(sum(case when o.payment_intent_id is not null or o.deposit_payment_intent_id is not null
                             then oi.price_per_unit * oi.quantity else 0 end), 0)
      from orders o
      left join order_items oi on oi.order_id = o.id and oi.deleted_at is null
     where o.deleted_at is null
       and (p_from is null or o.created_at >= p_from)
       and (p_to   is null or o.created_at <  p_to)
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = o.user_id)
     group by o.user_id;
$function$;
