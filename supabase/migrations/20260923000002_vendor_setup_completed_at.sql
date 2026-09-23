-- Tracks when a vendor finished the mandatory first-run setup (account →
-- shop details → logo/header → first storefront item → fulfillment →
-- Direct Deposit → terms → publish). The iOS app keeps a signed-in vendor
-- inside VendorSetupFlow until this is set; nothing else in the app is
-- reachable before then.
--
-- Every account that exists when this runs is backfilled as complete —
-- the flow is for new vendors only, existing ones never see it.
--
-- The backfill uses one fixed timestamp, 2026-09-23 00:00 UTC, on purpose:
-- 20260923000001 treats anyone at or before it as a pre-existing vendor
-- (grandfathered — products stay visible with ordering greyed out until
-- Stripe is connected) and anyone after it as someone who went through the
-- new setup flow and was told Direct Deposit is required. Accounts created
-- on older app builds after this runs stay NULL — re-run this same UPDATE
-- right before the setup-flow build ships so they're grandfathered too
-- and aren't pushed through setup.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS vendor_setup_completed_at TIMESTAMPTZ;

UPDATE public.profiles
SET vendor_setup_completed_at = '2026-09-23 00:00:00+00'
WHERE vendor_setup_completed_at IS NULL;
