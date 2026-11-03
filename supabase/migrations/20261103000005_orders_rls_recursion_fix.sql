-- "infinite recursion detected in policy for relation orders" (Harvey
-- 2026-11-03, on Send quote in the web app). Two policies left from the
-- buyer-marketplace era read public.orders from inside a policy on
-- public.orders, which Postgres refuses — and because every permissive policy
-- for a command is expanded, they broke ALL authenticated UPDATEs and INSERTs
-- on orders, not just buyers':
--   * marketplace_buyer_confirm_payment (UPDATE) — WITH CHECK compared
--     quoted_price to a subquery on orders (with a self-comparing WHERE).
--   * marketplace_buyer_create_order (INSERT) — a per-buyer rate limit counting
--     orders.
-- The buyer marketplace is paused; storefront orders are created and paid by
-- edge functions (service role). Buyers keep read-own and cancel-own; quote
-- requests still have marketplace_buyer_insert_quote_request.
DROP POLICY IF EXISTS marketplace_buyer_confirm_payment ON public.orders;
DROP POLICY IF EXISTS marketplace_buyer_create_order ON public.orders;
