-- Quotes must expire. Baker can also retract a quote.
-- quote_expires_at: set by baker when sending quote (default 72h after sending).
-- When expired or retracted, marketplace_status reverts to pending_quote.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMPTZ;

-- Allow the constraint to include reverted status (already present, but safety check)
-- No constraint change needed — pending_quote is already allowed.
