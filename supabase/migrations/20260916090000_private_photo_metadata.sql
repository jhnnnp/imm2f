-- Private memory photos with EXIF metadata and map-ready coordinates.

alter table public.memory_photos
  add column if not exists storage_path text,
  add column if not exists original_filename text not null default '',
  add column if not exists mime_type text not null default '',
  add column if not exists file_size bigint,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists camera_make text not null default '',
  add column if not exists camera_model text not null default '',
  add column if not exists orientation integer,
  add column if not exists location_source text not null default 'none'
    check (location_source in ('none', 'exif', 'place', 'manual')),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

update public.memory_photos
set storage_path = substring(storage_url from '/object/public/memory-photos/(.*)$')
where storage_path is null
  and storage_url like '%/object/public/memory-photos/%';

create index if not exists memory_photos_captured_idx
  on public.memory_photos(captured_at desc)
  where captured_at is not null;

create index if not exists memory_photos_coordinates_idx
  on public.memory_photos(latitude, longitude)
  where latitude is not null and longitude is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-photos',
  'memory-photos',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

