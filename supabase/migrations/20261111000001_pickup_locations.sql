-- Pickup locations (Harvey 2026-11-10 — for Cookiesbysteph's Show Low / Mesa
-- pre-sale, and markets: "buy ahead, collect at the stall").
--
-- A shop can have several pickup locations (home, a second town, a farmers
-- market). One is PRIMARY: the default for products, what a single-location
-- buyer sees, and what older app builds read — profiles.pickup_* always mirror
-- the primary location (both directions), so nothing that reads the shop's one
-- pickup address breaks.
--
-- Products choose where they can be collected (pickup_location_ids; NULL =
-- the primary only). A pre-order date can be tied to a location with an
-- optional time window (preorder_date_locations). Physical products can also
-- offer local pickup instead of shipping (physical_pickup). Orders record the
-- buyer's choice. With one location there's nothing to choose — the buyer
-- never sees a picker.
--
-- NOT APPLIED YET — review + roll out together (see docs/PICKUP-LOCATIONS.md).

CREATE TABLE IF NOT EXISTS public.pickup_locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (btrim(name) <> ''),
  address      TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  province     TEXT NOT NULL DEFAULT '',
  postal_code  TEXT NOT NULL DEFAULT '',
  -- Shown to buyers ("Look for the pink tent", "Back door, ring the bell").
  note         TEXT NOT NULL DEFAULT '',
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pickup_locations_user_idx ON public.pickup_locations (user_id) WHERE deleted_at IS NULL;
-- At most one primary per shop.
CREATE UNIQUE INDEX IF NOT EXISTS pickup_locations_one_primary
  ON public.pickup_locations (user_id) WHERE is_primary AND deleted_at IS NULL;

ALTER TABLE public.pickup_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pickup_locations_owner ON public.pickup_locations;
CREATE POLICY pickup_locations_owner ON public.pickup_locations
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Buyers never read this table directly: the storefront feed returns each
-- location's name, city and note; the street address is only sent after an
-- order is confirmed (same privacy as profiles.pickup_address today).

-- Products, pre-order dates, orders.
ALTER TABLE public.menu_items
  -- Where this product can be collected; NULL / empty = the primary location.
  ADD COLUMN IF NOT EXISTS pickup_location_ids UUID[],
  -- Pre-order date → location + optional window:
  -- {"2026-11-25T02:14:00Z": {"location_id": "…", "start": "08:00", "end": "12:00"}}
  ADD COLUMN IF NOT EXISTS preorder_date_locations JSONB,
  -- Physical products: also offer local pickup (no shipping) at their locations.
  ADD COLUMN IF NOT EXISTS physical_pickup BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_location_id UUID REFERENCES public.pickup_locations(id) ON DELETE SET NULL,
  -- Kept on the order so it reads right even if the location is renamed or removed.
  ADD COLUMN IF NOT EXISTS pickup_location_name TEXT;

-- ── Primary location ↔ profiles.pickup_* (both ways) ──────────────────────
-- Older app builds and every existing reader use profiles.pickup_address etc.;
-- they keep working because the primary location and those columns never
-- disagree. pg_trigger_depth() stops the two triggers re-firing each other.

CREATE OR REPLACE FUNCTION public.trg_pickup_location_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.is_primary AND NEW.deleted_at IS NULL THEN
    UPDATE public.profiles
    SET pickup_address = NEW.address, pickup_city = NEW.city,
        pickup_province = NEW.province, pickup_postal_code = NEW.postal_code
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pickup_location_to_profile ON public.pickup_locations;
CREATE TRIGGER pickup_location_to_profile
  AFTER INSERT OR UPDATE ON public.pickup_locations
  FOR EACH ROW EXECUTE FUNCTION public.trg_pickup_location_to_profile();

CREATE OR REPLACE FUNCTION public.trg_profile_pickup_to_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF (NEW.pickup_address, NEW.pickup_city, NEW.pickup_province, NEW.pickup_postal_code)
     IS DISTINCT FROM (OLD.pickup_address, OLD.pickup_city, OLD.pickup_province, OLD.pickup_postal_code) THEN
    UPDATE public.pickup_locations
    SET address = coalesce(NEW.pickup_address, ''), city = coalesce(NEW.pickup_city, ''),
        province = coalesce(NEW.pickup_province, ''), postal_code = coalesce(NEW.pickup_postal_code, ''),
        updated_at = now()
    WHERE user_id = NEW.id AND is_primary AND deleted_at IS NULL;
    -- A shop that never had a location gets its first (primary) one.
    IF NOT FOUND AND coalesce(btrim(NEW.pickup_address), '') <> '' THEN
      INSERT INTO public.pickup_locations (user_id, name, address, city, province, postal_code, is_primary)
      VALUES (NEW.id, coalesce(nullif(btrim(NEW.pickup_city), ''), 'Pickup'), NEW.pickup_address,
              coalesce(NEW.pickup_city, ''), coalesce(NEW.pickup_province, ''), coalesce(NEW.pickup_postal_code, ''), true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profile_pickup_to_location ON public.profiles;
CREATE TRIGGER profile_pickup_to_location
  AFTER UPDATE OF pickup_address, pickup_city, pickup_province, pickup_postal_code ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_pickup_to_location();

-- Backfill: every shop with a pickup address gets it as its primary location,
-- named after the city (rename any time in Pickup & hours).
INSERT INTO public.pickup_locations (user_id, name, address, city, province, postal_code, is_primary)
SELECT p.id, coalesce(nullif(btrim(p.pickup_city), ''), 'Pickup'), p.pickup_address,
       coalesce(p.pickup_city, ''), coalesce(p.pickup_province, ''), coalesce(p.pickup_postal_code, ''), true
FROM public.profiles p
WHERE coalesce(btrim(p.pickup_address), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.pickup_locations l WHERE l.user_id = p.id AND l.deleted_at IS NULL);

-- Storefront feeds (get_baker_web_profile_by_id / _by_slug) gain, at rollout:
--   profile.pickup_locations: [{id, name, city, province, note, is_primary}]  (no street address)
--   listing.pickup_location_ids, listing.preorder_date_locations, listing.physical_pickup
-- Those RPC bodies are regenerated from the live definitions when this ships,
-- the same way 20261110000002_presales.sql did — not hand-copied here.
