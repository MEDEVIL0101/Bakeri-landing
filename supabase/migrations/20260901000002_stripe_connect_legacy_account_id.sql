-- Adds the legacy-account-id column ahead of the cutover reset (see
-- stripe_standard_cutover_reset.sql), so cancel-order and
-- refund-and-notify-guest-order-declined can be deployed with a fallback to
-- it *before* any baker is actually disconnected. Safe/no-op until the
-- cutover reset populates it.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_connect_express_account_id_legacy TEXT;

COMMENT ON COLUMN public.profiles.stripe_connect_express_account_id_legacy IS
  'The baker''s pre-migration Express account id, kept after the cutover reset nulled stripe_connect_account_id. Needed to action refunds/disputes on Express-era orders and to close the old account once it is past its last order''s ~120-day dispute window.';
