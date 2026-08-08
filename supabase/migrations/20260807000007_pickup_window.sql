-- "Mark Ready for Pickup" used to just flip marketplace_status with no date
-- or time at all — the guest's ready email said "ready for pickup" and gave
-- an address, with no indication of *when* to come get it. Adds a time
-- window (mirroring delivery_window_start/delivery_window_end's existing
-- text-based pattern exactly) alongside the already-existing
-- scheduled_pickup_date (the day). Both are set together by the new
-- mark-order-ready-for-pickup edge function, which also lets the baker
-- schedule a future pickup slot (mark ready today for pickup tomorrow
-- 3-5pm) or reschedule an already-ready order's slot.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_window_start TEXT,
  ADD COLUMN IF NOT EXISTS pickup_window_end TEXT;

COMMENT ON COLUMN public.orders.pickup_window_start IS 'Display time string (e.g. "3:00 PM") for the start of the ready-for-pickup window. Paired with scheduled_pickup_date for the day and pickup_window_end for the end.';
COMMENT ON COLUMN public.orders.pickup_window_end IS 'Display time string (e.g. "5:00 PM") for the end of the ready-for-pickup window.';
