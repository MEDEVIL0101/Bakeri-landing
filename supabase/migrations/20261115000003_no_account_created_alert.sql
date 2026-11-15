-- Harvey 2026-11-15: the team's "New sign-up" email goes out only when someone
-- COMPLETES sign-up (their plan goes live — stripe-billing-webhook). Creating
-- an account isn't a sign-up, so the auth.users trigger that emailed on every
-- new account is removed.
DROP TRIGGER IF EXISTS trg_notify_team_signup ON auth.users;
