-- Caches the Stripe Terminal Location created on each baker's connected
-- account for Tap to Pay — a reader connection must register to a Location,
-- and create-terminal-connection-token creates one lazily on first use
-- rather than re-creating it on every connect.
alter table profiles
  add column if not exists stripe_terminal_location_id text;
