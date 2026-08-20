-- Same blast radius as 20260806000001 (Sugar'd Notes Cookie Co): these 7
-- bakers created a new Stripe Connect account while create-connect-account-
-- link's request-body parsing bug was live, so whatever country they
-- actually picked was silently discarded and forced to CA. All 7 are still
-- incomplete (never finished Stripe onboarding, no charges/payouts ever
-- possible) — safe to reset, same as disconnect-connect-account does.
-- Worst case for anyone who genuinely wanted Canada: a 10-second re-pick.
--
-- Guarded on stripe_connect_onboarding_complete = false so this is a no-op
-- (not destructive) against any of these that completed onboarding since
-- the investigation.
update profiles
set stripe_connect_account_id = null,
    stripe_connect_onboarding_complete = false,
    updated_at = now()
where id in (
    '43f964c9-e009-49cc-a213-195222dad513', -- Simply Sweet Cupcakes
    '680ec93d-64e1-40fe-94fb-373707a41299', -- Grateful Grain Sourdough Bakery
    '44c6dfd3-9251-4283-80ee-b5e318451e1f', -- Taylor'd Cookies
    '73532cf1-9c4d-451a-8a04-02da8f4b1e02', -- The Sunday Bakehouse
    '8cc92b5b-a3f1-4d49-ab3d-faf738356efe', -- Sweetsbysoph
    '7c7c7fe0-999d-4068-b2c6-9df5c7c3512b', -- Sarahs treats
    'c82953e3-fd56-4859-a537-7c231b0899e5'  -- Betty's Cookies
)
and stripe_connect_onboarding_complete = false;
