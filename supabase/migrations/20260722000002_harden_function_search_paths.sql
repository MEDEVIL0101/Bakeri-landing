-- Advisor: function_search_path_mutable (17 functions). A function without a
-- pinned search_path is vulnerable to search-path hijacking — a role with
-- schema-create privileges could shadow an unqualified table/function
-- reference the function relies on. Highest severity for the six that are
-- SECURITY DEFINER (claim_invoice, claim_and_pay_invoice,
-- fn_auto_join_group_creator, fn_baker_follow_counts,
-- fn_community_activity_on_comment, fn_community_activity_on_like), which
-- already run with elevated privileges.
--
-- ALTER FUNCTION ... SET search_path only pins the search path — it doesn't
-- touch the function body, so this can't change behavior for any function
-- whose logic already only references public/pg_catalog objects (true for
-- all of these).

ALTER FUNCTION public.trg_fn_propagate_delivery_flag() SET search_path = public;
ALTER FUNCTION public.fn_community_thread_like_count() SET search_path = public;
ALTER FUNCTION public.fn_community_comment_like_count() SET search_path = public;
ALTER FUNCTION public.fn_community_thread_comment_count() SET search_path = public;
ALTER FUNCTION public.fn_community_thread_view_count() SET search_path = public;
ALTER FUNCTION public.fn_community_group_member_count() SET search_path = public;
ALTER FUNCTION public.is_reserved_slug(text) SET search_path = public;
ALTER FUNCTION public.fn_community_activity_on_comment() SET search_path = public;
ALTER FUNCTION public.fn_community_activity_on_like() SET search_path = public;
ALTER FUNCTION public.fn_auto_join_group_creator() SET search_path = public;
ALTER FUNCTION public.fn_baker_follow_counts() SET search_path = public;
ALTER FUNCTION public.set_preorder_batch_updated_at() SET search_path = public;
ALTER FUNCTION public.trg_fn_baker_pickup_confirmed_notify() SET search_path = public;
ALTER FUNCTION public.claim_invoice(text) SET search_path = public;
ALTER FUNCTION public.trg_fn_order_message_notify() SET search_path = public;
ALTER FUNCTION public.claim_and_pay_invoice(text) SET search_path = public;
ALTER FUNCTION public.trg_fn_marketplace_order_notify() SET search_path = public;
