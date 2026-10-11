-- Creation attempts reuse the memory UUID. Keep the story, photos and partner
-- notifications in one transaction, so a lost response can safely be replayed.
set local lock_timeout = '5s';

create or replace function public.create_memory_atomic(
  target_id uuid,
  target_couple uuid,
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
  linked_place uuid;
  photo jsonb;
  photo_path text;
  photo_url text;
  file_object uuid;
  memory_lng double precision;
  memory_lat double precision;
  partner_id uuid;
begin
  if caller is null or target_couple is null or not public.is_couple_member(target_couple) then
    raise exception 'Not a member of the target couple' using errcode = '42501';
  end if;
  if target_id is null or jsonb_typeof(target_memory) is distinct from 'object'
    or jsonb_typeof(target_photos) is distinct from 'array'
    or jsonb_array_length(target_photos) > 12 then
    raise exception 'Invalid creation attempt' using errcode = '22023';
  end if;

  -- A transaction-level lock closes the race between two retries of the same
  -- UUID. It does not serialize unrelated memories or hold an HTTP session lock.
  perform pg_advisory_xact_lock(hashtextextended('memory-create:' || target_id::text, 0));
  select * into saved from public.memories where id = target_id;
  if found then
    if saved.couple_id <> target_couple or saved.created_by is distinct from caller then
      raise exception 'Creation attempt belongs to another member' using errcode = '42501';
    end if;
    return jsonb_build_object('created', false, 'memory', to_jsonb(saved), 'photos', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order, p.id), '[]'::jsonb)
      from public.memory_photos p where p.memory_id = saved.id
    ));
  end if;

  if jsonb_typeof(target_memory->'title') is distinct from 'string'
    or nullif(btrim(target_memory->>'title'), '') is null
    or length(target_memory->>'title') > 500
    or jsonb_typeof(target_memory->'description') is distinct from 'string'
    or jsonb_typeof(target_memory->'location_label') is distinct from 'string'
    or length(target_memory->>'description') > 20000
    or length(target_memory->>'location_label') > 1000
    or coalesce(target_memory->>'memory_type', 'free') not in ('free', 'trip', 'date')
    or coalesce(target_memory->>'happened_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Invalid memory fields' using errcode = '22023';
  end if;
  linked_place := nullif(target_memory->>'place_id', '')::uuid;
  if linked_place is not null and not exists (
    select 1 from public.places where id = linked_place and couple_id = target_couple
  ) then
    raise exception 'Place belongs to another couple or no longer exists' using errcode = '42501';
  end if;
  memory_lng := (target_memory->>'lng')::double precision;
  memory_lat := (target_memory->>'lat')::double precision;
  if (memory_lng is null) <> (memory_lat is null)
    or (memory_lng is not null and not (memory_lng between -180 and 180 and memory_lat between -90 and 90)) then
    raise exception 'Invalid memory coordinates' using errcode = '22023';
  end if;

  for photo in select value from jsonb_array_elements(target_photos) loop
    if jsonb_typeof(photo) is distinct from 'object' then
      raise exception 'Invalid photo' using errcode = '22023';
    end if;
    photo_path := nullif(photo->>'storage_path', '');
    photo_url := coalesce(photo->>'storage_url', '');
    if photo_path is not null then
      if split_part(photo_path, '/', 1) <> target_couple::text
        or photo_path ~ '(^|/)\.\.?(/|$)' or position(chr(92) in photo_path) > 0
        or position('//' in photo_path) > 0 then
        raise exception 'Photo belongs to another couple' using errcode = '42501';
      end if;
      -- RLS on storage.objects enforces membership as well; never sign or adopt
      -- a nonexistent file from a fabricated client metadata object.
      select id into file_object from storage.objects
        where bucket_id = 'memory-photos' and name = photo_path for key share;
      if not found then
        raise exception 'Photo upload is not available' using errcode = '22023';
      end if;
    elsif photo_url !~* '^https?://[^/[:space:]]+' then
      raise exception 'Invalid external photo URL' using errcode = '22023';
    end if;
    if coalesce(photo->>'location_source', 'none') not in ('none', 'exif', 'place', 'manual')
      or jsonb_typeof(coalesce(photo->'metadata', '{}'::jsonb)) <> 'object'
      or (photo->>'file_size')::bigint < 0 or (photo->>'file_size')::bigint > 20971520
      or ((photo->>'latitude')::double precision is null) <> ((photo->>'longitude')::double precision is null)
      or ((photo->>'latitude') is not null and not (
        (photo->>'latitude')::double precision between -90 and 90
        and (photo->>'longitude')::double precision between -180 and 180
      )) then
      raise exception 'Invalid photo metadata' using errcode = '22023';
    end if;
  end loop;

  insert into public.memories (
    id, couple_id, created_by, memory_type, place_id, title,
    happened_on, description, location_label, lng, lat
  ) values (
    target_id, target_couple, caller, coalesce(target_memory->>'memory_type', 'free'),
    linked_place, btrim(target_memory->>'title'), (target_memory->>'happened_on')::date,
    btrim(target_memory->>'description'), btrim(target_memory->>'location_label'), memory_lng, memory_lat
  ) returning * into saved;

  insert into public.memory_photos (
    memory_id, storage_url, caption, sort_order, latitude, longitude, captured_at,
    storage_path, original_filename, mime_type, file_size, width, height,
    camera_make, camera_model, orientation, location_source, metadata
  ) select
    saved.id, coalesce(nullif(p.photo->>'storage_path', ''), p.photo->>'storage_url'), '', p.ordinality - 1,
    (p.photo->>'latitude')::double precision, (p.photo->>'longitude')::double precision,
    (p.photo->>'captured_at')::timestamptz, nullif(p.photo->>'storage_path', ''),
    coalesce(p.photo->>'original_filename', ''), coalesce(p.photo->>'mime_type', ''),
    (p.photo->>'file_size')::bigint, (p.photo->>'width')::integer, (p.photo->>'height')::integer,
    coalesce(p.photo->>'camera_make', ''), coalesce(p.photo->>'camera_model', ''),
    (p.photo->>'orientation')::integer, coalesce(p.photo->>'location_source', 'none'),
    coalesce(p.photo->'metadata', '{}'::jsonb)
  from jsonb_array_elements(target_photos) with ordinality as p(photo, ordinality);

  insert into public.activities (couple_id, actor_user_id, entity_type, entity_id, action, title, detail)
  values (target_couple, caller, 'memory', saved.id::text, 'MEMORY_ADDED', '추억을 남겼어요', saved.title);
  select user_id into partner_id from public.couple_members
    where couple_id = target_couple and user_id <> caller limit 1;
  if partner_id is not null then
    insert into public.email_outbox (couple_id, recipient_user_id, subject, body, status)
    values (target_couple, partner_id, '[ONLY US] 새로운 추억을 남겼어요',
      saved.title || case when saved.location_label <> '' then ' · ' || saved.location_label else '' end, 'queued');
  end if;

  return jsonb_build_object('created', true, 'memory', to_jsonb(saved), 'photos', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order, p.id), '[]'::jsonb)
    from public.memory_photos p where p.memory_id = saved.id
  ));
end;
$$;

revoke execute on function public.create_memory_atomic(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_memory_atomic(uuid, uuid, jsonb, jsonb) to authenticated;
