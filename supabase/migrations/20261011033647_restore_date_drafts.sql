set local lock_timeout = '5s';

create table if not exists public.date_drafts (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  scheduled_on date not null,
  title text not null default '',
  notes text not null default '',
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (couple_id, scheduled_on)
);

create index if not exists date_drafts_couple_id_idx on public.date_drafts(couple_id, scheduled_on);

drop trigger if exists date_drafts_set_updated_at on public.date_drafts;
create trigger date_drafts_set_updated_at
  before update on public.date_drafts
  for each row execute function public.set_updated_at();

alter table public.date_drafts enable row level security;

drop policy if exists date_drafts_select on public.date_drafts;
create policy date_drafts_select on public.date_drafts
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists date_drafts_insert on public.date_drafts;
create policy date_drafts_insert on public.date_drafts
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

drop policy if exists date_drafts_update on public.date_drafts;
create policy date_drafts_update on public.date_drafts
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

drop policy if exists date_drafts_delete on public.date_drafts;
create policy date_drafts_delete on public.date_drafts
  for delete to authenticated
  using (public.is_couple_member(couple_id));

grant select, insert, update, delete on public.date_drafts to authenticated;

-- Preserve the activity-based drafts used before this table existed. Only the
-- latest snapshot counts; a later deletion must never revive an older draft.
with latest as (
  select distinct on (couple_id, entity_id)
    couple_id, entity_id, after_value, created_at
  from public.activities
  where entity_type = 'date_draft'
  order by couple_id, entity_id, created_at desc, id desc
)
insert into public.date_drafts (couple_id, scheduled_on, title, notes, items, updated_at)
select l.couple_id, l.entity_id::date,
  coalesce(l.after_value ->> 'title', '우리가 고른 데이트'),
  coalesce(l.after_value ->> 'notes', ''), l.after_value -> 'items', l.created_at
from latest l
join public.couples c on c.id = l.couple_id
where l.entity_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and pg_catalog.pg_input_is_valid(l.entity_id, 'date')
  and jsonb_typeof(l.after_value) = 'object'
  and coalesce(l.after_value ->> 'deleted', 'false') <> 'true'
  and jsonb_typeof(l.after_value -> 'items') = 'array'
  and (l.after_value -> 'items' <> '[]'::jsonb
    or btrim(coalesce(l.after_value ->> 'notes', '')) <> ''
    or btrim(coalesce(l.after_value ->> 'title', '')) not in ('', '우리가 고른 데이트'))
on conflict (couple_id, scheduled_on) do nothing;
