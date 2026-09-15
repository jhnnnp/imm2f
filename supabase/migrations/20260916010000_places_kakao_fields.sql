-- Copy Kakao place metadata into couple-scoped places without mixing user notes.

alter table public.places
  add column if not exists address text not null default '',
  add column if not exists road_address text,
  add column if not exists phone text,
  add column if not exists map_url text,
  add column if not exists opening_hours text,
  add column if not exists external_source text not null default 'manual',
  add column if not exists external_place_id text;

alter table public.places
  drop constraint if exists places_external_source_check;
alter table public.places
  add constraint places_external_source_check
  check (external_source in ('kakao', 'manual'));

alter table public.places
  alter column expected_cost_two drop not null;

create unique index if not exists places_couple_external_unique
  on public.places (couple_id, external_source, external_place_id)
  where external_place_id is not null;
