-- Tracks when a user accepted the Terms of Service / Privacy Policy.
-- Nullable and starts unset for every existing account (there was previously
-- no in-app acceptance step at all) — the app treats NULL as "needs to
-- accept" for everyone, new and existing, via TermsAcceptanceGate.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
