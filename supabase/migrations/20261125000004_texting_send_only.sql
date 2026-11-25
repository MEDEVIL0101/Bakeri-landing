-- Texting is send-only (Harvey 2026-11-25): one shared Bakerï number sends;
-- replies aren't taken in. Each text ends with how to reach the baker directly,
-- so the shop gives the number customers should text her on.
alter table public.profiles add column if not exists sms_reply_phone text;
