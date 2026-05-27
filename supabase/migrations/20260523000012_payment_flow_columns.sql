-- Add payment flow infrastructure columns to orders table
-- These support three Stripe payment flows:
--   auth_hold        — immediate authorization hold, captured at pickup (ready_now + pre-sale ≤7d)
--   setup_intent     — card saved via SetupIntent, hold placed 6 days before pickup (pre-sale >7d)
--   deposit_and_save — deposit charged immediately + card saved, balance hold placed by baker ~7d before pickup (custom)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_flow text NOT NULL DEFAULT 'auth_hold';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS setup_intent_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_amount_cents integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_hold_at timestamptz;

COMMENT ON COLUMN orders.payment_flow IS 'auth_hold | setup_intent | deposit_and_save';
COMMENT ON COLUMN orders.setup_intent_id IS 'Stripe SetupIntent ID — used to place auth hold later';
COMMENT ON COLUMN orders.deposit_amount_cents IS 'Amount already charged as deposit (deposit_and_save flow)';
COMMENT ON COLUMN orders.scheduled_hold_at IS 'When the server should place the auth hold (setup_intent flow)';
