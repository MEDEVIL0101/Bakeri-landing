-- Legal gates for Bakeri marketplace
-- Add gate flag columns to the profiles table (actual table used by the app)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketplace_onboarded  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS baker_type             TEXT,
  ADD COLUMN IF NOT EXISTS delivery_gate_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposits_gate_accepted BOOLEAN NOT NULL DEFAULT FALSE;
