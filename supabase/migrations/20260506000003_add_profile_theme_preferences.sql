-- Add theme preference columns to profiles so settings sync across devices.
alter table public.profiles
  add column if not exists selected_theme    text not null default 'Classic',
  add column if not exists background_pattern text not null default 'Standard';
