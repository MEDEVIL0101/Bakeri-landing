-- Two-way texting (Harvey 2026-11-25, for bakers like Oh Sourdough who run on
-- Hotplate's texts): a baker texts a customer from the order, the customer
-- replies by text, and the reply lands in that order's Texts thread.
-- One shared Bakerï number (Twilio); every text is prefixed with the shop's
-- name, and a reply is routed to the order that phone was last texted about.
-- Rows are written only by the edge functions (service role): send-order-text
-- and twilio-sms-inbound.

create table if not exists public.order_texts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null,                        -- the baker (orders.user_id)
  direction text not null check (direction in ('out', 'in')),
  body text not null,
  customer_phone text not null,                 -- E.164, e.g. +17175551234
  twilio_sid text,
  status text,                                  -- Twilio status for 'out'
  read_at timestamptz,                          -- baker has seen an 'in' text
  created_at timestamptz not null default now()
);
create index if not exists order_texts_order_idx on public.order_texts (order_id, created_at);
create index if not exists order_texts_phone_idx on public.order_texts (customer_phone, created_at desc);
create index if not exists order_texts_unread_idx on public.order_texts (user_id) where direction = 'in' and read_at is null;

alter table public.order_texts enable row level security;
drop policy if exists "Baker reads own order texts" on public.order_texts;
create policy "Baker reads own order texts" on public.order_texts
  for select to authenticated using (user_id = auth.uid());
-- Only read_at may change from the app (marking replies seen).
drop policy if exists "Baker marks own texts read" on public.order_texts;
create policy "Baker marks own texts read" on public.order_texts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.order_texts from authenticated, anon;
revoke update on public.order_texts from authenticated, anon;
grant update (read_at) on public.order_texts to authenticated;

-- Numbers that texted STOP (removed on START). Never texted again.
create table if not exists public.sms_opt_outs (
  phone text primary key,
  created_at timestamptz not null default now()
);
alter table public.sms_opt_outs enable row level security;   -- no policies: functions only

-- The shop's switch: texting is off until the baker turns it on.
alter table public.profiles add column if not exists sms_enabled boolean not null default false;
