-- One-time data fix: same class of issue as 20260714000014 (Tilly's Sugar
-- Cookies) — Sweet Southern Bakery's profile has a Stripe Connect account ID
-- (acct_1TrMh1RuCDsdbnKM) that the platform's current live secret key
-- cannot access ("does not have access ... or account does not exist"),
-- confirmed via direct Stripe API test. This account predates a platform
-- Stripe key change and is now orphaned. create-connect-account-link reuses
-- stripe_connect_account_id when present rather than creating a new one, so
-- this stale reference breaks every checkout on this baker's storefront
-- (ready_now, preorder, and quote payment all hit the same "provided key
-- does not have access" error) until cleared.

UPDATE public.profiles
SET stripe_connect_account_id = NULL,
    stripe_connect_onboarding_complete = false
WHERE id = 'db3ce8d4-9f8a-420b-8a89-7d781ac98162'
  AND stripe_connect_account_id = 'acct_1TrMh1RuCDsdbnKM';
