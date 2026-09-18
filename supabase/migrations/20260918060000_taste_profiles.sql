create table if not exists public.taste_profiles (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  areas text[] not null default '{}',
  pace text not null check (pace in ('linger', 'mixed', 'walk')),
  activities text[] not null default '{}',
  cuisines text[] not null default '{}',
  avoid_foods text[] not null default '{}',
  setting text not null check (setting in ('indoor', 'outdoor', 'mix')),
  crowd text not null check (crowd in ('quiet', 'lively', 'mix')),
  budget text not null check (budget in ('modest', 'comfortable', 'generous')),
  time_window text not null check (time_window in ('afternoon', 'evening', 'night', 'any')),
  area_scope text not null check (area_scope in ('core', 'walkable', 'nearby')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  constraint taste_profiles_areas_len check (cardinality(areas) between 1 and 4),
  constraint taste_profiles_activities_len check (cardinality(activities) between 1 and 4),
  constraint taste_profiles_cuisines_len check (cardinality(cuisines) between 1 and 4),
  constraint taste_profiles_avoid_len check (cardinality(avoid_foods) between 0 and 8),
  constraint taste_profiles_note_len check (char_length(note) <= 160)
);

drop trigger if exists taste_profiles_set_updated_at on public.taste_profiles;
create trigger taste_profiles_set_updated_at
  before update on public.taste_profiles
  for each row execute function public.set_updated_at();

alter table public.taste_profiles enable row level security;

drop policy if exists taste_profiles_select on public.taste_profiles;
create policy taste_profiles_select on public.taste_profiles
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists taste_profiles_insert on public.taste_profiles;
create policy taste_profiles_insert on public.taste_profiles
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and user_id = auth.uid());

drop policy if exists taste_profiles_update on public.taste_profiles;
create policy taste_profiles_update on public.taste_profiles
  for update to authenticated
  using (public.is_couple_member(couple_id) and user_id = auth.uid())
  with check (public.is_couple_member(couple_id) and user_id = auth.uid());

drop policy if exists taste_profiles_delete on public.taste_profiles;
create policy taste_profiles_delete on public.taste_profiles
  for delete to authenticated
  using (public.is_couple_member(couple_id) and user_id = auth.uid());

grant select, insert, update, delete on public.taste_profiles to authenticated;
