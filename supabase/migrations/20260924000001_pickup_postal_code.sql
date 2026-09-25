-- Stripe's Terminal Location API requires postal_code (confirmed live,
-- 2026-09-24: "Missing required address field for a Location in CA:
-- address[postal_code]") — pickup_address/city/province alone weren't
-- enough for create-terminal-connection-token to create a Location for
-- Tap to Pay. MKPlacemark already resolves this during address search;
-- it just wasn't being captured or stored anywhere.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS pickup_postal_code TEXT NOT NULL DEFAULT '';
