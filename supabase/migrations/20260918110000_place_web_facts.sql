alter table public.place_details_cache
  add column if not exists rating numeric,
  add column if not exists rating_count integer,
  add column if not exists food text,
  add column if not exists source_url text,
  add column if not exists blurb text;
