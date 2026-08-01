-- ============================================================
-- Per-line preorder date on order_items
-- A single order can now contain multiple preorder lines for the same
-- listing on different dates (buyer picks date A, adds to cart, picks
-- date B, adds to cart again, etc. — baker/index.html now keeps these as
-- separate cart lines instead of collapsing them into one). The order
-- itself still has a single due_date/scheduled_pickup_date (the earliest
-- across all lines, unchanged), but the baker fulfilling a mixed-date
-- order needs to know which line is due which day — this column carries
-- that server-resolved date per order_item, exactly the read-only,
-- buyer/server-authored pattern already used for tier_label/variant_breakdown.
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS preorder_date timestamptz;
