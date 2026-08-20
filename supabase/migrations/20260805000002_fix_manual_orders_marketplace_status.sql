-- finalize-invoice-payment unconditionally set marketplace_status='completed'
-- and completed_at on every paid invoice, including plain manual orders
-- (order_source='manual', no buyer_profile_id — never claimed in-app).
-- marketplace_status is documented NULL-for-manual by this table's own check
-- constraint (see 20260522000001_marketplace_phase1.sql), and the app UI
-- reads it to route/list orders as marketplace orders — so a baker's manual
-- order that got invoiced and paid would appear to have turned into a
-- marketplace order. The edge function is fixed to stop doing this going
-- forward; this repairs orders already corrupted by it.
--
-- Scoped tightly: only rows that are order_source='manual' AND have no
-- buyer_profile_id (never claimed) AND currently sit at marketplace_status
-- 'completed' — no legitimate code path sets marketplace_status on an
-- unclaimed manual order, so this signature uniquely identifies the bug's
-- damage, not any other feature's data.
update orders
set marketplace_status = null,
    completed_at = null,
    updated_at = now()
where order_source = 'manual'
  and buyer_profile_id is null
  and marketplace_status = 'completed';
