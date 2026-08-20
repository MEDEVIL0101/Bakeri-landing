-- user_boards: lets buyers save posts into named boards (birthday, wedding, etc.)

create table if not exists user_boards (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  emoji       text        not null default '📌',
  description text        not null default '',
  created_at  timestamptz not null default now()
);

-- index for fast per-user lookups
create index if not exists user_boards_user_id_idx on user_boards(user_id);

-- RLS
alter table user_boards enable row level security;

-- users can read, create, update and delete their own boards
create policy "own_boards_select" on user_boards
  for select using (auth.uid() = user_id);

create policy "own_boards_insert" on user_boards
  for insert with check (auth.uid() = user_id);

create policy "own_boards_update" on user_boards
  for update using (auth.uid() = user_id);

create policy "own_boards_delete" on user_boards
  for delete using (auth.uid() = user_id);
