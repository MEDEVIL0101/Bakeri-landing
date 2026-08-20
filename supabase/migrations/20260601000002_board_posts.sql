-- board_posts: links community posts to user boards

create table if not exists board_posts (
  id         uuid        primary key default gen_random_uuid(),
  board_id   uuid        not null references user_boards(id) on delete cascade,
  thread_id  uuid        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (board_id, thread_id)
);

create index if not exists board_posts_board_id_idx on board_posts(board_id);
create index if not exists board_posts_user_id_idx  on board_posts(user_id);
create index if not exists board_posts_thread_id_idx on board_posts(thread_id);

alter table board_posts enable row level security;

create policy "own_board_posts_select" on board_posts
  for select using (auth.uid() = user_id);

create policy "own_board_posts_insert" on board_posts
  for insert with check (auth.uid() = user_id);

create policy "own_board_posts_delete" on board_posts
  for delete using (auth.uid() = user_id);
