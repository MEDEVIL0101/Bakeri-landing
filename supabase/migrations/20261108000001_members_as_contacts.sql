-- Course and club members are customers too (Harvey 2026-11-08): everyone
-- enrolled in a course or club is on the shop's contacts list, so email
-- campaigns can go to "members of X" (updates, upsells). A contact the shop
-- already has is left as it is — including anyone who unsubscribed or said
-- no to marketing, whom campaigns keep skipping.

alter table public.baker_contacts drop constraint if exists baker_contacts_source_check;
alter table public.baker_contacts add constraint baker_contacts_source_check
  check (source = any (array['order', 'popup', 'inline', 'header', 'lead_magnet', 'manual', 'course', 'club']));

create or replace function public.enrollment_to_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into baker_contacts (user_id, email, name, source)
  select new.user_id, lower(trim(new.email)), new.name,
         case when coalesce(m.is_club, false) then 'club' else 'course' end
  from menu_items m
  where m.id = new.menu_item_id
    and not exists (select 1 from baker_contacts c where c.user_id = new.user_id and lower(c.email) = lower(trim(new.email)))
  on conflict (user_id, email) do nothing;
  return new;
end $$;

drop trigger if exists enrollment_to_contact on public.course_enrollments;
create trigger enrollment_to_contact after insert on public.course_enrollments
  for each row execute function public.enrollment_to_contact();

-- Everyone already enrolled.
insert into baker_contacts (user_id, email, name, source)
select distinct on (e.user_id, lower(trim(e.email))) e.user_id, lower(trim(e.email)), e.name,
       case when coalesce(m.is_club, false) then 'club' else 'course' end
from course_enrollments e join menu_items m on m.id = e.menu_item_id
where not exists (select 1 from baker_contacts c where c.user_id = e.user_id and lower(c.email) = lower(trim(e.email)))
order by e.user_id, lower(trim(e.email)), e.created_at
on conflict (user_id, email) do nothing;
