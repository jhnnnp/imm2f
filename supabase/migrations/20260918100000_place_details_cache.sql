-- Public POI metadata cache. No couple PII. Kakao Local has no hours/photos;
-- we store leaf/phone from search and fill image/hours from saved places or TourAPI.

create table if not exists public.place_details_cache (
  external_source text not null check (external_source in ('kakao', 'tourapi')),
  external_place_id text not null,
  name text not null default '',
  leaf text not null default '',
  phone text,
  map_url text,
  image text,
  hours text,
  fetched_at timestamptz not null default now(),
  primary key (external_source, external_place_id)
);

alter table public.place_details_cache enable row level security;

create policy place_details_cache_select on public.place_details_cache
  for select to authenticated
  using (true);

create policy place_details_cache_upsert on public.place_details_cache
  for insert to authenticated
  with check (true);

create policy place_details_cache_update on public.place_details_cache
  for update to authenticated
  using (true)
  with check (true);

grant select, insert, update on public.place_details_cache to authenticated;
