-- Security audit 2026-10-31 — fixes for what the public anon key (shipped in
-- every page and the apps, so effectively public) could reach.

BEGIN;

-- ── 1. profiles: anon sees display columns only ──────────────────────────────
-- 20260601000003 limited anon to safe columns; a later table-level grant put
-- every column back (email, pickup_address, pickup_postal_code,
-- gst_hst_number, stripe_connect_account_id …). Storefront pages read
-- profiles through SECURITY DEFINER RPCs, so nothing public needs more.
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT (
    id, user_name, business_name, community_handle, bio, specialty_tags,
    location, follower_count, following_count, updated_at, profile_slug
) ON public.profiles TO anon;

-- PostgREST never exposes these, but nothing client-side should hold them.
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    LOOP
        EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t.relname);
    END LOOP;
END $$;

-- ── 2. Server-only functions: no anon / signed-in access ─────────────────────
-- No permission check inside, and only edge functions (service role), the
-- Bakeri Admin app (service role) or other SECURITY DEFINER code call them.
--   admin_cancel_order / admin_suspend_baker — anyone could cancel any order
--   admin_daily_order_metrics / admin_platform_summary — platform financials
--   decrement_*_stock_batch — anyone could zero a shop's stock
--   redeem_promo_code — anyone could use up a promo code
--   send_marketplace_notification — anyone could push-notify any user
--   call_guest_order_webhook — anyone could trigger order emails
--   expire_overdue_guest_orders, resolve_order_item_image_id — internal
--   mock_confirm_quote_payment — dev helper: marked a quote paid with no payment
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN (
                 'admin_cancel_order', 'admin_suspend_baker', 'admin_daily_order_metrics',
                 'admin_platform_summary', 'decrement_listing_variant_stock_batch',
                 'decrement_menu_item_stock_batch', 'redeem_promo_code',
                 'send_marketplace_notification', 'call_guest_order_webhook',
                 'expire_overdue_guest_orders', 'resolve_order_item_image_id',
                 'mock_confirm_quote_payment')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END LOOP;
END $$;

-- ── 3. force_complete_marketplace_order: check pickup server-side ────────────
-- The app only calls it once both sides confirmed pickup, but the function
-- itself let either party mark an order completed + captured at any time.
CREATE OR REPLACE FUNCTION public.force_complete_marketplace_order(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer UUID;
    v_owner UUID;
    v_both  BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT buyer_profile_id, user_id,
           COALESCE(baker_pickup_confirmed, false) AND COALESCE(buyer_pickup_confirmed, false)
    INTO v_buyer, v_owner, v_both
    FROM orders WHERE id = p_order_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF auth.uid() IS DISTINCT FROM v_buyer AND auth.uid() IS DISTINCT FROM v_owner THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    IF NOT v_both THEN
        RAISE EXCEPTION 'pickup_not_confirmed';
    END IF;

    UPDATE orders SET
        marketplace_status = 'completed',
        payment_status      = 'captured',
        updated_at          = now()
    WHERE id = p_order_id;

    RETURN json_build_object('ok', true);
END;
$$;

-- ── 4. Storage: vendors reach only their own files ───────────────────────────
-- auth_* let ANY signed-in account (anyone can sign up) read, overwrite or
-- delete every vendor's order photos, menu images, logos, recipe and
-- ingredient images. Every object in these buckets lives under
-- <owner user id>/…, so scope to that folder. Public buckets
-- (menu-item-images, business-logos) are still readable by URL as before.
DROP POLICY IF EXISTS auth_select ON storage.objects;
DROP POLICY IF EXISTS auth_insert ON storage.objects;
DROP POLICY IF EXISTS auth_update ON storage.objects;
DROP POLICY IF EXISTS auth_delete ON storage.objects;

CREATE POLICY owner_files_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id IN ('recipe-images', 'ingredient-images', 'menu-item-images', 'order-photos', 'business-logos')
           AND upper((storage.foldername(name))[1]) = upper(auth.uid()::text));
CREATE POLICY owner_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('recipe-images', 'ingredient-images', 'menu-item-images', 'order-photos', 'business-logos')
           AND upper((storage.foldername(name))[1]) = upper(auth.uid()::text));
CREATE POLICY owner_files_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id IN ('recipe-images', 'ingredient-images', 'menu-item-images', 'order-photos', 'business-logos')
           AND upper((storage.foldername(name))[1]) = upper(auth.uid()::text))
    WITH CHECK (bucket_id IN ('recipe-images', 'ingredient-images', 'menu-item-images', 'order-photos', 'business-logos')
           AND upper((storage.foldername(name))[1]) = upper(auth.uid()::text));
CREATE POLICY owner_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id IN ('recipe-images', 'ingredient-images', 'menu-item-images', 'order-photos', 'business-logos')
           AND upper((storage.foldername(name))[1]) = upper(auth.uid()::text));

-- Customers' inspiration photos: inspiration_photos_select already lets the
-- order's buyer and vendor read them; this one let every account read all.
DROP POLICY IF EXISTS authenticated_read_inspiration ON storage.objects;

COMMIT;
