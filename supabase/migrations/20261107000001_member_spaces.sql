-- Member spaces for courses and clubs (Harvey 2026-11-07).
--   • Email-code sign-in: a buyer enters their email on the shop's member
--     page, gets a 6-digit code, and the device keeps a member session that
--     opens every course/club they have with that shop (member-space fn).
--   • A Slack-style channel per course/club: everyone with access posts,
--     replies in threads and reacts; the shop posts as itself, pins, marks
--     posts as Updates (emailed to members) and removes messages.
-- Members never touch these tables directly — the member-space function
-- (service role) checks their session or access token. Vendors read and
-- moderate their own channels through RLS (web app / iOS builder).

alter table public.menu_items
  add column if not exists channel_enabled boolean not null default true,
  add column if not exists members_can_post boolean not null default true;

create table if not exists public.member_login_codes (
  id         uuid primary key default gen_random_uuid(),
  baker_id   uuid not null references auth.users(id) on delete cascade,
  email      text not null,
  code_hash  text not null,
  attempts   integer not null default 0,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists member_login_codes_lookup on public.member_login_codes (baker_id, lower(email), created_at desc);

create table if not exists public.member_sessions (
  id           uuid primary key default gen_random_uuid(),
  baker_id     uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  token        uuid not null default gen_random_uuid() unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '180 days',
  revoked_at   timestamptz
);

create table if not exists public.channel_messages (
  id            uuid primary key default gen_random_uuid(),
  baker_id      uuid not null references auth.users(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  -- null = posted by the shop itself.
  enrollment_id uuid references public.course_enrollments(id) on delete cascade,
  author_name   text not null default '',
  body          text not null default '',
  -- Attachments, as content blocks (image / video / file).
  attachments   jsonb check (attachments is null or jsonb_typeof(attachments) = 'array'),
  parent_id     uuid references public.channel_messages(id) on delete cascade,
  is_pinned     boolean not null default false,
  is_update     boolean not null default false,
  reply_count   integer not null default 0,
  last_reply_at timestamptz,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz
);
create index if not exists channel_messages_feed on public.channel_messages (menu_item_id, created_at desc) where parent_id is null;
create index if not exists channel_messages_thread on public.channel_messages (parent_id, created_at);

create table if not exists public.channel_reactions (
  message_id uuid not null references public.channel_messages(id) on delete cascade,
  -- 'shop' or the reacting enrollment's id.
  actor      text not null,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, actor, emoji)
);

create table if not exists public.channel_reads (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  actor        text not null,
  last_read_at timestamptz not null default now(),
  primary key (menu_item_id, actor)
);

-- Thread reply counts.
create or replace function public.channel_reply_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    update channel_messages set reply_count = reply_count + 1, last_reply_at = new.created_at where id = new.parent_id;
  elsif tg_op = 'UPDATE' and new.parent_id is not null and old.deleted_at is null and new.deleted_at is not null then
    update channel_messages set reply_count = greatest(reply_count - 1, 0) where id = new.parent_id;
  end if;
  return new;
end $$;
drop trigger if exists channel_reply_count on public.channel_messages;
create trigger channel_reply_count after insert or update of deleted_at on public.channel_messages
  for each row execute function public.channel_reply_count();

alter table public.member_login_codes enable row level security;
alter table public.member_sessions enable row level security;
alter table public.channel_messages enable row level security;
alter table public.channel_reactions enable row level security;
alter table public.channel_reads enable row level security;

drop policy if exists "own channel messages" on public.channel_messages;
create policy "own channel messages" on public.channel_messages for all to authenticated
  using (baker_id = auth.uid()) with check (baker_id = auth.uid());
drop policy if exists "own channel reactions" on public.channel_reactions;
create policy "own channel reactions" on public.channel_reactions for select to authenticated
  using (exists (select 1 from public.channel_messages m where m.id = message_id and m.baker_id = auth.uid()));

revoke all on public.member_login_codes, public.member_sessions, public.channel_messages, public.channel_reactions, public.channel_reads from anon;
revoke all on public.member_login_codes, public.member_sessions, public.channel_reads from authenticated;
grant select, insert, update, delete on public.channel_messages to authenticated;
grant select on public.channel_reactions to authenticated;
grant all on public.member_login_codes, public.member_sessions, public.channel_messages, public.channel_reactions, public.channel_reads to service_role;

-- What a storefront card shows about a course/club: counts only, never content.
create or replace function public.get_member_space_summaries(p_ids uuid[]) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(mi.id, json_build_object(
    'modules', (select count(*) from course_modules m where m.menu_item_id = mi.id and m.deleted_at is null),
    'lessons', (select count(*) from course_lessons l where l.menu_item_id = mi.id and l.deleted_at is null),
    'previews', (select count(*) from course_lessons l where l.menu_item_id = mi.id and l.deleted_at is null and l.is_preview),
    'members', (select count(*) from course_enrollments e where e.menu_item_id = mi.id and e.revoked_at is null),
    'posts_30d', (select count(*) from channel_messages c where c.menu_item_id = mi.id and c.enrollment_id is null
                    and c.parent_id is null and c.deleted_at is null and c.created_at > now() - interval '30 days')
  )), '{}'::json)
  from menu_items mi
  where mi.id = any(p_ids) and mi.is_course and mi.deleted_at is null and mi.is_listed_in_marketplace;
$$;
revoke all on function public.get_member_space_summaries(uuid[]) from public;
grant execute on function public.get_member_space_summaries(uuid[]) to anon, authenticated, service_role;
