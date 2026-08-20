-- claim_invoice computed quoted_price from the (at the time, un-deduplicated)
-- order_items sum, doubling it for any order that had been edited at least
-- once before being claimed. Recompute it now from the corrected item total.
UPDATE orders o
SET quoted_price = (
        SELECT COALESCE(SUM(quantity * price_per_unit), 0)
        FROM order_items
        WHERE order_id = o.id AND deleted_at IS NULL
    ),
    updated_at = now()
WHERE o.id = '0b1ffe34-382e-4927-8143-77b4c7e8ed7e';
