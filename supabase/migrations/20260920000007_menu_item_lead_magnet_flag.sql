-- Lead magnet flag on menu_items — same "sticky marker, excluded from the
-- normal grid" precedent as is_storefront_form (see
-- 20260910000001_storefront_form_takeover.sql / menu_item_storefront_form_flag).
-- A lead-magnet listing is a free digital deliverable created from a link
-- card's or the Email Capture block's "Upload a file" shortcut — it stays
-- is_listed_in_marketplace = false (so both get_baker_web_profile RPCs'
-- existing `WHERE is_listed_in_marketplace = true` filter already excludes
-- it from the normal feed with no RPC change needed) and is reachable only
-- via the specific baker_links.linked_listing_id or
-- profiles.email_capture_deliverable_listing_id that references it.

ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS is_lead_magnet BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.menu_items.is_lead_magnet IS
    'Free digital deliverable created via a link card''s or the Email Capture block''s "Upload a file" shortcut. Excluded from the normal Menu/Digital Downloads feed (is_listed_in_marketplace stays false); delivered by capture-storefront-email on a free signup, not through the paid checkout path.';
