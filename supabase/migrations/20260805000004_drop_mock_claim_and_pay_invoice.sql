-- claim_and_pay_invoice never called Stripe — it marked orders is_paid=true
-- directly in the database ("still TEST MODE" per its own original comment
-- in 20260712000014_claim_and_pay_invoice_atomic.sql). The app is live, so
-- this let real buyers get marked as having paid without being charged.
-- Replaced by claim_invoice (unchanged, just attaches the buyer) followed by
-- a real Stripe Connect direct charge via the new pay-invoice-order edge
-- function + finalize-invoice-payment. Dropped outright, not just
-- unreferenced from the client, so it can't be invoked directly via the
-- REST API either.
DROP FUNCTION IF EXISTS public.claim_and_pay_invoice(text);
