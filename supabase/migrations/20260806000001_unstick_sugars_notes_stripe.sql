-- One-off unblock for Sugar'd Notes Cookie Co (profile 77495cf7-ec63-4f30-
-- b78a-d1d98cb0632c): got stuck on an incomplete Canadian Stripe Express
-- account (acct_1U1EsQRtfh3dn9SC, created 2026-08-06, details_submitted /
-- charges_enabled both false) because of the request-body parsing bug in
-- create-connect-account-link that silently discarded her country
-- selection (fixed same day). With onboarding never completed, the app's
-- own "Disconnect Stripe" button never renders (BankingPaymentsView gates
-- it on stripe_connect_onboarding_complete = true), so she had no
-- self-serve way to retry — this mirrors exactly what disconnect-connect-
-- account does, just run directly since she can't reach that button.
-- Leaves the Stripe-side account alone (same reasoning as disconnect-
-- connect-account) — it's an incomplete, unused Express account, nothing
-- to clean up there.
update profiles
set stripe_connect_account_id = null,
    stripe_connect_onboarding_complete = false,
    updated_at = now()
where id = '77495cf7-ec63-4f30-b78a-d1d98cb0632c';
