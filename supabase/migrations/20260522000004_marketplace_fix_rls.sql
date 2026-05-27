-- Drop the old marketplace read policy that required is_active = true,
-- then recreate it without that constraint.
-- is_listed_in_marketplace = true is the baker's explicit signal; is_active
-- is an internal menu management flag that shouldn't block marketplace visibility.

DROP POLICY IF EXISTS "marketplace_items_public_read" ON menu_items;

CREATE POLICY "marketplace_items_public_read"
ON menu_items FOR SELECT
USING (
    is_listed_in_marketplace = true
);
