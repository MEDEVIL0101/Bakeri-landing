-- Re-pin search_path on claim_invoice / claim_and_pay_invoice — the
-- 20260722000002 hardening pass pinned both via ALTER FUNCTION, but
-- ALTER FUNCTION ... SET does not survive a later CREATE OR REPLACE
-- FUNCTION of the same signature. Both were redefined since (most recently
-- by 20260807000004_disable_in_app_invoice_claim.sql for claim_invoice, and
-- 20260805000003_order_source_immutable.sql for claim_and_pay_invoice)
-- without re-specifying the pin, silently regressing both back to a mutable
-- search_path — the exact class of vulnerability 20260722000002 fixed.
-- SECURITY DEFINER functions with a mutable search_path are vulnerable to
-- search-path hijacking by any role with schema-create privileges.
--
-- Any future CREATE OR REPLACE FUNCTION on a SECURITY DEFINER function must
-- re-specify `SET search_path = public` inline in the same statement — it
-- does not inherit from a prior ALTER FUNCTION call.

ALTER FUNCTION public.claim_invoice(text) SET search_path = public;
ALTER FUNCTION public.claim_and_pay_invoice(text) SET search_path = public;
