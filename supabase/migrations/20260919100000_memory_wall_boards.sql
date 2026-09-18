create table if not exists public.memory_wall_boards (
  couple_id uuid primary key references public.couples(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.memory_wall_boards enable row level security;

create policy memory_wall_boards_select on public.memory_wall_boards
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy memory_wall_boards_insert on public.memory_wall_boards
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and updated_by = auth.uid());

create policy memory_wall_boards_update on public.memory_wall_boards
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id) and updated_by = auth.uid());

grant select, insert, update on public.memory_wall_boards to authenticated;

alter publication supabase_realtime add table public.memory_wall_boards;
