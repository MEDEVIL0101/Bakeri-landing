-- Add baker_display_name to orders so buyers see the bakery/baker name
-- without needing a join, and fix any stored emails (privacy).

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS baker_display_name TEXT NOT NULL DEFAULT '';

-- Backfill baker_display_name from profiles for all marketplace orders
UPDATE orders o
SET baker_display_name = COALESCE(
    NULLIF(TRIM(p.business_name), ''),
    NULLIF(TRIM(p.user_name), ''),
    'Baker'
)
FROM profiles p
WHERE o.user_id = p.id
  AND o.order_source = 'marketplace';

-- Fix buyer_display_name: replace any stored emails with community_handle / user_name
-- (emails contain '@' but community handles also start with '@' after our fix,
--  so we target rows that contain '.' after '@' which indicates email format)
UPDATE orders o
SET buyer_display_name = CASE
    WHEN TRIM(p.community_handle) <> '' THEN '@' || TRIM(p.community_handle)
    WHEN TRIM(p.user_name)        <> '' THEN TRIM(p.user_name)
    ELSE buyer_display_name
END,
customer_name = CASE
    WHEN TRIM(p.community_handle) <> '' THEN '@' || TRIM(p.community_handle)
    WHEN TRIM(p.user_name)        <> '' THEN TRIM(p.user_name)
    ELSE customer_name
END
FROM profiles p
WHERE o.buyer_profile_id = p.id
  AND o.order_source = 'marketplace'
  AND o.buyer_display_name ~ '^[^@]+@[^@]+\.[^@]+$';
