-- Feedback table for in-app feedback form
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  category    text not null,
  message     text not null,
  app_version text,
  os_version  text
);

-- Only the authenticated user can insert their own feedback
alter table public.feedback enable row level security;

create policy "Users can insert their own feedback"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

-- No select/update/delete for users — only accessible via service role (your desktop client)
