-- Fix marketplace orders that still have the placeholder order_name "Custom quote request"
-- Uses the baker's business_name (primary) or user_name (fallback) from profiles
UPDATE orders o
SET order_name = COALESCE(
    NULLIF(TRIM(p.business_name), ''),
    NULLIF(TRIM(p.user_name), ''),
    o.order_name
)
FROM profiles p
WHERE o.user_id = p.id
  AND o.order_source = 'marketplace'
  AND o.order_name = 'Custom quote request';
