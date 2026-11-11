-- Pickup hours (and the buyer note) per location (Harvey 2026-11-10). The
-- PRIMARY location's hours / note mirror profiles.pickup_hours_json /
-- pickup_note both ways — so a one-location shop that shows hours on its
-- storefront sees no change, and older app builds keep working. A shop with
-- 2+ locations that shows hours gets per-location hours on the storefront
-- (web, at rollout).
ALTER TABLE public.pickup_locations ADD COLUMN IF NOT EXISTS hours_json JSONB;

UPDATE public.pickup_locations l
SET hours_json = p.pickup_hours_json,
    note = CASE WHEN l.note = '' THEN coalesce(p.pickup_note, '') ELSE l.note END
FROM public.profiles p
WHERE p.id = l.user_id AND l.is_primary;

CREATE OR REPLACE FUNCTION public.trg_pickup_location_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.is_primary AND NEW.deleted_at IS NULL THEN
    UPDATE public.profiles
    SET pickup_address = NEW.address, pickup_city = NEW.city,
        pickup_province = NEW.province, pickup_postal_code = NEW.postal_code,
        pickup_hours_json = NEW.hours_json, pickup_note = NEW.note
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_profile_pickup_to_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF (NEW.pickup_address, NEW.pickup_city, NEW.pickup_province, NEW.pickup_postal_code, NEW.pickup_hours_json::text, NEW.pickup_note)
     IS DISTINCT FROM (OLD.pickup_address, OLD.pickup_city, OLD.pickup_province, OLD.pickup_postal_code, OLD.pickup_hours_json::text, OLD.pickup_note) THEN
    UPDATE public.pickup_locations
    SET address = coalesce(NEW.pickup_address, ''), city = coalesce(NEW.pickup_city, ''),
        province = coalesce(NEW.pickup_province, ''), postal_code = coalesce(NEW.pickup_postal_code, ''),
        hours_json = NEW.pickup_hours_json, note = coalesce(NEW.pickup_note, ''),
        updated_at = now()
    WHERE user_id = NEW.id AND is_primary AND deleted_at IS NULL;
    IF NOT FOUND AND coalesce(btrim(NEW.pickup_address), '') <> '' THEN
      INSERT INTO public.pickup_locations (user_id, name, address, city, province, postal_code, hours_json, note, is_primary)
      VALUES (NEW.id, coalesce(nullif(btrim(NEW.pickup_city), ''), 'Pickup'), NEW.pickup_address,
              coalesce(NEW.pickup_city, ''), coalesce(NEW.pickup_province, ''), coalesce(NEW.pickup_postal_code, ''),
              NEW.pickup_hours_json, coalesce(NEW.pickup_note, ''), true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profile_pickup_to_location ON public.profiles;
CREATE TRIGGER profile_pickup_to_location
  AFTER UPDATE OF pickup_address, pickup_city, pickup_province, pickup_postal_code, pickup_hours_json, pickup_note ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_pickup_to_location();
