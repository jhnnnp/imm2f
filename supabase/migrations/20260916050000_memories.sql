-- Memories and memory photos for couple archives / Our Map pins.

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  memory_type text not null default 'free' check (memory_type in ('free', 'trip', 'date')),
  place_id uuid references public.places(id) on delete set null,
  title text not null,
  happened_on date not null default current_date,
  description text not null default '',
  location_label text not null default '',
  lng double precision,
  lat double precision,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists memories_couple_happened_idx
  on public.memories(couple_id, happened_on desc);

create table if not exists public.memory_photos (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  storage_url text not null,
  latitude double precision,
  longitude double precision,
  captured_at timestamptz,
  caption text not null default '',
  sort_order integer not null default 0
);

create index if not exists memory_photos_memory_idx
  on public.memory_photos(memory_id, sort_order);

alter table public.memories enable row level security;
alter table public.memory_photos enable row level security;

drop policy if exists memories_select on public.memories;
create policy memories_select on public.memories
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists memories_insert on public.memories;
create policy memories_insert on public.memories
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

drop policy if exists memories_update on public.memories;
create policy memories_update on public.memories
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

drop policy if exists memories_delete on public.memories;
create policy memories_delete on public.memories
  for delete to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists memory_photos_select on public.memory_photos;
create policy memory_photos_select on public.memory_photos
  for select to authenticated
  using (
    exists (
      select 1 from public.memories
      where memories.id = memory_photos.memory_id
        and public.is_couple_member(memories.couple_id)
    )
  );

drop policy if exists memory_photos_insert on public.memory_photos;
create policy memory_photos_insert on public.memory_photos
  for insert to authenticated
  with check (
    exists (
      select 1 from public.memories
      where memories.id = memory_id
        and public.is_couple_member(memories.couple_id)
    )
  );

drop policy if exists memory_photos_update on public.memory_photos;
create policy memory_photos_update on public.memory_photos
  for update to authenticated
  using (
    exists (
      select 1 from public.memories
      where memories.id = memory_photos.memory_id
        and public.is_couple_member(memories.couple_id)
    )
  )
  with check (
    exists (
      select 1 from public.memories
      where memories.id = memory_id
        and public.is_couple_member(memories.couple_id)
    )
  );

drop policy if exists memory_photos_delete on public.memory_photos;
create policy memory_photos_delete on public.memory_photos
  for delete to authenticated
  using (
    exists (
      select 1 from public.memories
      where memories.id = memory_photos.memory_id
        and public.is_couple_member(memories.couple_id)
    )
  );

grant select, insert, update, delete on public.memories, public.memory_photos to authenticated;
