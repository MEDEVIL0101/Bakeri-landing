-- Quote / order emails and pushes silently stopped (Harvey 2026-11-03: quote
-- sent → customer got nothing; quote retracted → no notice; "Resend quote"
-- worked). Cause: 20261031000002_security_hardening made
-- call_guest_order_webhook() and send_marketplace_notification() server-only
-- (revoked from anon/authenticated). These trigger functions were SECURITY
-- INVOKER, so when a vendor changed an order from the apps they ran as that
-- vendor, the calls were refused, and each trigger's EXCEPTION handler turned
-- it into a WARNING — no email, no push, no visible error.
--
-- Run them as their owner instead (the usual pattern for notification
-- triggers). The helper functions stay unreachable from clients directly.
ALTER FUNCTION public.trg_fn_marketplace_order_notify() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.trg_fn_baker_pickup_confirmed_notify() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.trg_fn_order_message_notify() SECURITY DEFINER SET search_path = public;
