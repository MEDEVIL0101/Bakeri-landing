-- The in-app "claim and pay an invoice" flow (EnterInvoiceCodeView ->
-- claim_invoice -> pay-invoice-order) is paused (decision 2026-08-07) — the
-- 2026-08-07 incident (see SUPPORT_LOG.md) showed the accidental-open path
-- (an auto-fired bakeri:// deep link from /pay/) could silently claim an
-- invoice with no real payment, permanently locking the web pay link into
-- "already claimed" with no way for the baker to reissue. That specific
-- trigger is fixed, but the feature as a whole isn't solid enough to leave
-- reachable yet. Gating the claim itself here is the single authoritative
-- choke point: pay-invoice-order requires an existing claim
-- (buyer_profile_id = auth.uid()), so blocking claim_invoice blocks the
-- whole path regardless of how a buyer reaches it (deep link, manual code
-- entry, or anything added later). Guest/web payment via /pay/ +
-- create-invoice-payment-intent is untouched — this only affects paying an
-- invoice from inside the app itself.
--
-- Trivially reversible: drop this migration's effect by re-deploying the
-- claim_invoice body from 20260807000002_invoice_claim_respects_quoted_price.sql.

CREATE OR REPLACE FUNCTION public.claim_invoice(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RAISE EXCEPTION 'feature_disabled';
END;
$$;
