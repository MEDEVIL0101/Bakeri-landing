-- Make marketplace-facing image buckets publicly readable.
-- The publicURL pattern used in MarketplaceService only works for public buckets.
-- menu-item-images and business-logos are intended for marketplace display.

UPDATE storage.buckets
SET public = true
WHERE id IN ('menu-item-images', 'business-logos');
