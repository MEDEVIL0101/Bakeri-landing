-- Add marketplace_listing_id to community_threads
-- Allows bakers to attach a menu item to a post so buyers can shop directly from the feed.

ALTER TABLE community_threads
  ADD COLUMN IF NOT EXISTS marketplace_listing_id UUID REFERENCES menu_items(id) ON DELETE SET NULL;
