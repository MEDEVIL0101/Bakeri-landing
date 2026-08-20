-- One-time data fix: this baker's profile has a Stripe Connect account ID
-- (acct_1TtDPM2LBtO90BLY) created before today's switch to live Stripe
-- keys — confirmed via direct API test that the live secret key cannot
-- access this account ("does not have access ... or account does not
-- exist"), the standard Stripe error for a test-mode account under a live
-- key. create-connect-account-link reuses stripe_connect_account_id when
-- present rather than creating a new one, so this stale reference would
-- otherwise keep breaking (or worse, silently sandbox-routing) every
-- subsequent onboarding attempt. Clearing it lets the next "Connect with
-- Stripe" tap create a genuine live account instead.

UPDATE public.profiles
SET stripe_connect_account_id = NULL,
    stripe_connect_onboarding_complete = false
WHERE id = '9cca2737-16f8-47dd-8b9f-c4e089aaf394';
