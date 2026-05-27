-- Backfill buyer_display_name for existing marketplace orders that stored the
-- buyer's email instead of their community handle / user name.
-- Prefers @community_handle, falls back to user_name, leaves email-only rows fixed.

UPDATE orders o
SET buyer_display_name = CASE
    WHEN TRIM(p.community_handle) <> '' THEN '@' || TRIM(p.community_handle)
    WHEN TRIM(p.user_name)        <> '' THEN TRIM(p.user_name)
    ELSE o.buyer_display_name
END
FROM profiles p
WHERE o.buyer_profile_id = p.id
  AND o.order_source = 'marketplace'
  AND (
    -- only rows that look like an email (contain @) or are the generic fallback
    o.buyer_display_name LIKE '%@%'
    OR o.buyer_display_name = 'Bakeri customer'
  );

-- Mirror to customer_name so the baker's order sheet shows the same value
UPDATE orders
SET customer_name = buyer_display_name
WHERE order_source = 'marketplace'
  AND buyer_profile_id IS NOT NULL;
