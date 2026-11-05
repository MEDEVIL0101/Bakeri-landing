-- Pipeline refocus (Harvey 2026-11-04): Bakerï now goes after creators like
-- Cookies by Steph (social following, sells through a link in bio, takes
-- payment through Bakerï checkout), not the tools-era sign-ups the pipeline
-- was first filled from.
--
-- • fit: 'creator' | 'tools' | 'unsure'. Every existing row is tools-era.
-- • Creators are usually found on Instagram/TikTok before we have an email,
--   so email becomes optional (still unique when present).
-- • tiktok_url, sells, followers, referred_by, and fit_checks — the
--   Steph-like checklist keys: social_following, sells_drops, link_in_bio,
--   takes_preorders, ships_or_digital.

alter table public.crm_prospects alter column email drop not null;

alter table public.crm_prospects
  add column if not exists fit         text   not null default 'tools',
  add column if not exists tiktok_url  text,
  add column if not exists sells       text,
  add column if not exists followers   integer check (followers is null or followers >= 0),
  add column if not exists referred_by text,
  add column if not exists fit_checks  text[] not null default '{}';

do $$ begin
  alter table public.crm_prospects add constraint crm_prospects_fit_check
    check (fit in ('creator', 'tools', 'unsure'));
exception when duplicate_object then null; end $$;

create index if not exists crm_prospects_fit_idx on public.crm_prospects (fit);
