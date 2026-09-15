-- Multi-day trips, calendar start dates, couple lists, memory photo storage.

alter table public.plans
  add column if not exists start_date date,
  add column if not exists day_count integer not null default 1;

alter table public.plan_items
  add column if not exists day_index integer not null default 0;

update public.plans set day_count = greatest(day_count, 1) where day_count < 1;

create table if not exists public.couple_notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null check (kind in ('vault', 'gift', 'bucket')),
  title text not null,
  detail text not null default '',
  status text not null default 'open',
  extra text not null default '',
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists couple_notes_couple_kind_idx
  on public.couple_notes(couple_id, kind, sort_order);

drop trigger if exists couple_notes_set_updated_at on public.couple_notes;
create trigger couple_notes_set_updated_at
  before update on public.couple_notes
  for each row execute function public.set_updated_at();

alter table public.couple_notes enable row level security;

drop policy if exists couple_notes_select on public.couple_notes;
create policy couple_notes_select on public.couple_notes
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists couple_notes_insert on public.couple_notes;
create policy couple_notes_insert on public.couple_notes
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

drop policy if exists couple_notes_update on public.couple_notes;
create policy couple_notes_update on public.couple_notes
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

drop policy if exists couple_notes_delete on public.couple_notes;
create policy couple_notes_delete on public.couple_notes
  for delete to authenticated
  using (public.is_couple_member(couple_id));

grant select, insert, update, delete on public.couple_notes to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-photos',
  'memory-photos',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists memory_photos_select on storage.objects;
create policy memory_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'memory-photos'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists memory_photos_insert on storage.objects;
create policy memory_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'memory-photos'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists memory_photos_update on storage.objects;
create policy memory_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'memory-photos'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'memory-photos'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists memory_photos_delete on storage.objects;
create policy memory_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'memory-photos'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );
