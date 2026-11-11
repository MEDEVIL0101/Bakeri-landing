-- Every storefront_design block always carries "hidden" (Harvey 2026-11-10).
-- The iPhone app's V2Block decoder requires the key; a block without it (the
-- web's "Give it its own card", or the web builder dropping hidden:false) made
-- the app read the whole design as missing and show the shop's old original
-- layout — and an app publish from that state would overwrite the real site.
-- The app now tolerates a missing key, but builds already out there don't:
-- this trigger fills it in on every write, and the backfill fixes saved rows.

CREATE OR REPLACE FUNCTION public.storefront_design_blocks_hidden(d JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(d->'blocks') = 'array'
    THEN jsonb_set(d, '{blocks}', (
      SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(b) = 'object' AND NOT (b ? 'hidden')
                                     THEN b || '{"hidden": false}'::jsonb ELSE b END ORDER BY i), '[]'::jsonb)
      FROM jsonb_array_elements(d->'blocks') WITH ORDINALITY AS t(b, i)))
    ELSE d END;
$$;

CREATE OR REPLACE FUNCTION public.trg_storefront_design_blocks_hidden()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.storefront_design IS NOT NULL THEN
    NEW.storefront_design := public.storefront_design_blocks_hidden(NEW.storefront_design);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS storefront_design_blocks_hidden ON public.profiles;
CREATE TRIGGER storefront_design_blocks_hidden
  BEFORE INSERT OR UPDATE OF storefront_design ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_storefront_design_blocks_hidden();

UPDATE public.profiles
SET storefront_design = public.storefront_design_blocks_hidden(storefront_design)
WHERE storefront_design IS NOT NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(storefront_design->'blocks') = 'array' THEN storefront_design->'blocks' ELSE '[]'::jsonb END) b
              WHERE jsonb_typeof(b) = 'object' AND NOT (b ? 'hidden'));
