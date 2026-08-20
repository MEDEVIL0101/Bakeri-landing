-- One-off repair: this order was claimed in-app (marketplace_status =
-- quote_provided) then paid through the web invoice page before
-- finalize-invoice-payment knew to also flip marketplace_status. Left it
-- showing "Quote Received / Review & Pay" despite being paid.
UPDATE orders
SET marketplace_status = 'confirmed', updated_at = now()
WHERE id = '0b1ffe34-382e-4927-8143-77b4c7e8ed7e'
  AND is_paid = true
  AND marketplace_status = 'quote_provided';
