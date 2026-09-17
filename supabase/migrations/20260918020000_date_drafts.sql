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
