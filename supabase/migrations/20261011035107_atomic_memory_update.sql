-- Persist one receipt per immutable edit. Story changes, new photos and the
-- partner event share the transaction, including edits that only add photos.
set local lock_timeout = '5s';

create table public.memory_update_attempts (
  attempt_id uuid primary key,
  memory_id uuid not null references public.memories(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  created_at timestamptz not null default now()
);
create index memory_update_attempts_memory_id_idx on public.memory_update_attempts(memory_id);
create index memory_update_attempts_couple_id_idx on public.memory_update_attempts(couple_id);
create index memory_update_attempts_actor_user_id_idx on public.memory_update_attempts(actor_user_id);
alter table public.memory_update_attempts enable row level security;
revoke all on public.memory_update_attempts from public, anon, authenticated;
grant select, insert on public.memory_update_attempts to authenticated;
create policy memory_update_attempts_select on public.memory_update_attempts
  for select to authenticated using (
    actor_user_id = (select auth.uid()) and public.is_couple_member(couple_id)
  );
create policy memory_update_attempts_insert on public.memory_update_attempts
  for insert to authenticated with check (
    actor_user_id = (select auth.uid()) and public.is_couple_member(couple_id)
    and exists (select 1 from public.memories m where m.id = memory_id and m.couple_id = memory_update_attempts.couple_id)
  );

create or replace function public.update_memory_atomic(
  target_attempt uuid,
  target_id uuid,
  target_couple uuid,
  target_expected jsonb,
  target_memory jsonb,
  target_photos jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  caller uuid := auth.uid();
  saved public.memories%rowtype;
  receipt public.memory_update_attempts%rowtype;
  edit_request jsonb;
  photo jsonb;
  photo_path text;
  photo_url text;
  file_object uuid;
  memory_lng double precision;
  memory_lat double precision;
  photo_count integer;
  photo_start integer;
begin
  if caller is null or target_couple is null or not public.is_couple_member(target_couple) then
    raise exception 'Not a member of the target couple' using errcode = '42501';
  end if;
  if target_attempt is null or target_id is null
    or jsonb_typeof(target_expected) is distinct from 'array' or jsonb_array_length(target_expected) <> 6
    or jsonb_typeof(target_memory) is distinct from 'object'
    or jsonb_typeof(target_photos) is distinct from 'array' or jsonb_array_length(target_photos) > 12 then
    raise exception 'Invalid edit attempt' using errcode = '22023';
  end if;
  edit_request := jsonb_build_object('expected', target_expected, 'memory', target_memory, 'photos', target_photos);
  perform pg_advisory_xact_lock(hashtextextended('memory-update:' || target_attempt::text, 0));
  select * into receipt from public.memory_update_attempts where attempt_id = target_attempt;
  if found then
    if receipt.actor_user_id <> caller or receipt.memory_id <> target_id
      or receipt.couple_id <> target_couple or receipt.request <> edit_request then
      raise exception 'Edit attempt does not match this request' using errcode = '22023';
    end if;
    -- Return the current canonical record. A replay acknowledges this edit
    -- without erasing a later change the partner has already made.
    select * into saved from public.memories where id = target_id and couple_id = target_couple;
    if not found then raise exception 'Memory no longer exists' using errcode = 'P0002'; end if;
    return jsonb_build_object('replayed', true, 'memory', to_jsonb(saved), 'photos', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order, p.id), '[]'::jsonb)
      from public.memory_photos p where p.memory_id = target_id
    ));
  end if;

  -- Serialize edits of one memory. Different memories can still save at once.
  select * into saved from public.memories where id = target_id and couple_id = target_couple for update;
  if not found then raise exception 'Memory no longer exists' using errcode = 'P0002'; end if;
  if target_expected <> jsonb_build_array(saved.title, saved.happened_on::text,
    saved.description, saved.location_label, saved.memory_type,
    case when saved.lng is null or saved.lat is null then 'null'::jsonb else jsonb_build_array(saved.lng, saved.lat) end) then
    raise exception 'Memory edit conflict' using errcode = 'P0001';
  end if;
  if jsonb_typeof(target_memory->'title') is distinct from 'string'
    or nullif(btrim(target_memory->>'title'), '') is null or length(target_memory->>'title') > 500
    or jsonb_typeof(target_memory->'description') is distinct from 'string'
    or jsonb_typeof(target_memory->'location_label') is distinct from 'string'
    or length(target_memory->>'description') > 20000 or length(target_memory->>'location_label') > 1000
    or coalesce(target_memory->>'memory_type', '') not in ('free', 'trip', 'date')
    or coalesce(target_memory->>'happened_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Invalid memory fields' using errcode = '22023';
  end if;
  memory_lng := (target_memory->>'lng')::double precision;
  memory_lat := (target_memory->>'lat')::double precision;
  if (memory_lng is null) <> (memory_lat is null)
    or (memory_lng is not null and not (memory_lng between -180 and 180 and memory_lat between -90 and 90)) then
    raise exception 'Invalid memory coordinates' using errcode = '22023';
  end if;
  select count(*), coalesce(max(sort_order) + 1, 0) into photo_count, photo_start
    from public.memory_photos where memory_id = target_id;
  if photo_count + jsonb_array_length(target_photos) > 12 then
    raise exception 'Too many photos' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(target_photos) p where nullif(p->>'storage_path', '') is not null)
    <> (select count(distinct p->>'storage_path') from jsonb_array_elements(target_photos) p where nullif(p->>'storage_path', '') is not null) then
    raise exception 'Duplicate photo upload' using errcode = '22023';
  end if;
  for photo in select value from jsonb_array_elements(target_photos) loop
    if jsonb_typeof(photo) is distinct from 'object' then raise exception 'Invalid photo' using errcode = '22023'; end if;
    photo_path := nullif(photo->>'storage_path', '');
    photo_url := coalesce(photo->>'storage_url', '');
    if photo_path is not null then
      if split_part(photo_path, '/', 1) <> target_couple::text
        or photo_path ~ '(^|/)\.\.?(/|$)' or position(chr(92) in photo_path) > 0 or position('//' in photo_path) > 0 then
        raise exception 'Photo belongs to another couple' using errcode = '42501';
      end if;
      select id into file_object from storage.objects
        where bucket_id = 'memory-photos' and name = photo_path for key share;
      if not found then raise exception 'Photo upload is not available' using errcode = '22023'; end if;
      if exists (select 1 from public.memory_photos where memory_id = target_id and storage_path = photo_path) then
        raise exception 'Photo is already attached' using errcode = '22023';
      end if;
    elsif photo_url !~* '^https?://[^/[:space:]]+' then
      raise exception 'Invalid external photo URL' using errcode = '22023';
    end if;
    if coalesce(photo->>'location_source', 'none') not in ('none', 'exif', 'place', 'manual')
      or jsonb_typeof(coalesce(photo->'metadata', '{}'::jsonb)) <> 'object'
      or (photo->>'file_size')::bigint < 0 or (photo->>'file_size')::bigint > 20971520
      or ((photo->>'latitude')::double precision is null) <> ((photo->>'longitude')::double precision is null)
      or ((photo->>'latitude') is not null and not (
        (photo->>'latitude')::double precision between -90 and 90 and (photo->>'longitude')::double precision between -180 and 180
      )) then raise exception 'Invalid photo metadata' using errcode = '22023'; end if;
  end loop;

  update public.memories set title = btrim(target_memory->>'title'),
    happened_on = (target_memory->>'happened_on')::date, description = btrim(target_memory->>'description'),
    location_label = btrim(target_memory->>'location_label'), memory_type = target_memory->>'memory_type',
    lng = memory_lng, lat = memory_lat where id = target_id and couple_id = target_couple returning * into saved;
  if not found then raise exception 'Memory update is not allowed' using errcode = '42501'; end if;
  insert into public.memory_photos (
    memory_id, storage_url, caption, sort_order, latitude, longitude, captured_at,
    storage_path, original_filename, mime_type, file_size, width, height,
    camera_make, camera_model, orientation, location_source, metadata
  ) select target_id, coalesce(nullif(p.photo->>'storage_path', ''), p.photo->>'storage_url'), '', photo_start + p.ordinality - 1,
    (p.photo->>'latitude')::double precision, (p.photo->>'longitude')::double precision,
    (p.photo->>'captured_at')::timestamptz, nullif(p.photo->>'storage_path', ''),
    coalesce(p.photo->>'original_filename', ''), coalesce(p.photo->>'mime_type', ''),
    (p.photo->>'file_size')::bigint, (p.photo->>'width')::integer, (p.photo->>'height')::integer,
    coalesce(p.photo->>'camera_make', ''), coalesce(p.photo->>'camera_model', ''),
    (p.photo->>'orientation')::integer, coalesce(p.photo->>'location_source', 'none'), coalesce(p.photo->'metadata', '{}'::jsonb)
    from jsonb_array_elements(target_photos) with ordinality as p(photo, ordinality);
  insert into public.activities (couple_id, actor_user_id, entity_type, entity_id, action, title, detail)
    values (target_couple, caller, 'memory', target_id::text, 'MEMORY_UPDATED', '추억을 다듬었어요', saved.title);
  insert into public.memory_update_attempts (attempt_id, memory_id, couple_id, actor_user_id, request)
    values (target_attempt, target_id, target_couple, caller, edit_request);

  return jsonb_build_object('replayed', false, 'memory', to_jsonb(saved), 'photos', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order, p.id), '[]'::jsonb)
    from public.memory_photos p where p.memory_id = target_id
  ));
end;
$$;
revoke execute on function public.update_memory_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_memory_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
