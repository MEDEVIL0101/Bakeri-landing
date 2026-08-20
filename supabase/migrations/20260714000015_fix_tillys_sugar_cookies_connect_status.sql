-- One-time data fix: Tilly's Sugar Cookies (acct_1TtEnjRvRhrJFYkj) genuinely
-- completed Stripe Connect onboarding — confirmed directly against Stripe's
-- API (charges_enabled: true, payouts_enabled: true, details_submitted:
-- true, no pending requirements) — but stripe_connect_onboarding_complete
-- never flipped, because the account.updated webhook that's supposed to do
-- this didn't successfully process for this account. See the follow-up
-- investigation into why (not fixed by this migration, which only unblocks
-- this one baker).

UPDATE public.profiles
SET stripe_connect_onboarding_complete = true
WHERE id = '9cca2737-16f8-47dd-8b9f-c4e089aaf394'
  AND stripe_connect_account_id = 'acct_1TtEnjRvRhrJFYkj';
