-- Cache public venue facts. Browsers may read but only the trusted server writes.
create table if not exists public.place_details_cache (
  external_source text not null check (external_source in ('kakao', 'tourapi')),
  external_place_id text not null,
  name text not null default '',
  leaf text not null default '',
  phone text,
  map_url text,
  image text,
  hours text,
  rating numeric,
  rating_count integer,
  food text,
  source_url text,
  blurb text,
  fetched_at timestamptz not null default now(),
  primary key (external_source, external_place_id)
);

alter table public.place_details_cache
  add column if not exists rating numeric,
  add column if not exists rating_count integer,
  add column if not exists food text,
  add column if not exists source_url text,
  add column if not exists blurb text;

alter table public.place_details_cache enable row level security;
drop policy if exists place_details_cache_select on public.place_details_cache;
drop policy if exists place_details_cache_upsert on public.place_details_cache;
drop policy if exists place_details_cache_update on public.place_details_cache;
create policy place_details_cache_select on public.place_details_cache
  for select to authenticated using (true);

revoke all on public.place_details_cache from public, anon, authenticated;
grant select on public.place_details_cache to authenticated;
grant select, insert, update on public.place_details_cache to service_role;
