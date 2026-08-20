-- Bakers' Stripe Connect accounts were always created with country: "CA"
-- hardcoded (create-connect-account-link), regardless of where the baker
-- actually is — Stripe's hosted onboarding then shows/locks the country to
-- whatever the account was created with, which read as "it keeps
-- auto-selecting Canada" to a US baker. This column lets the baker pick
-- their real country before the account is created.
--
-- Default 'CA' is a correct backfill, not a guess — every account created
-- before this migration really was Canadian.
alter table profiles
    add column if not exists country text not null default 'CA';
