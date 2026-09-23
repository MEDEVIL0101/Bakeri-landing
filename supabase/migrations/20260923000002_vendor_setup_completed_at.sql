-- Tracks when a vendor finished the mandatory first-run setup (account →
-- shop details → logo/header → first storefront item → fulfillment →
-- Direct Deposit → terms → publish). The iOS app keeps a signed-in vendor
-- inside VendorSetupFlow until this is set; nothing else in the app is
-- reachable before then.
--
-- Every account that exists when this runs is backfilled as complete —
-- the flow is for new vendors only, existing ones never see it.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS vendor_setup_completed_at TIMESTAMPTZ;

UPDATE public.profiles
SET vendor_setup_completed_at = now()
WHERE vendor_setup_completed_at IS NULL;
