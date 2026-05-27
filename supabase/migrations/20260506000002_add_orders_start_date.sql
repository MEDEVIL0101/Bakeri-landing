-- Add start_date to orders so multi-day orders span correctly on the calendar.
-- Column is nullable — orders without a start date use due_date as the single event day.
alter table public.orders
  add column if not exists start_date timestamptz;

-- Add color_name while we're here — used for order pill colour on the calendar.
alter table public.orders
  add column if not exists color_name text not null default 'red';
