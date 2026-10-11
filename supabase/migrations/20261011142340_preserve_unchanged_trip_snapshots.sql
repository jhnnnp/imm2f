-- Keep confirmation tokens stable for unchanged snapshots and prevent saves
-- from racing a user moving between couple workspaces.
set local lock_timeout = '5s';

-- Remove the former overloads: named/default arguments now resolve only to
-- the guarded signatures, including existing positional eight/three calls.
drop function public.reschedule_couple_trip(date,bigint,timestamptz);
drop function public.save_couple_plan_atomic(text,text,text,date,integer,jsonb,text,bigint);

CREATE OR REPLACE FUNCTION public.save_couple_plan_atomic(target_kind text, target_title text, target_subtitle text, target_start_date date, target_day_count integer, target_items jsonb, target_summary text, expected_revision bigint DEFAULT NULL::bigint, expected_couple_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  cid uuid := public.my_couple_id();
  uid uuid := auth.uid();
  saved_plan public.plans%rowtype;
  created boolean := false;
  next_version integer;
  action_name text;
  action_title text;
  draft_items jsonb;
begin
  if uid is null or cid is null then
    raise exception 'not authenticated';
  end if;
  -- Invite acceptance uses this same first lock. Resolve the workspace again
  -- after waiting so a save cannot write into a space the user has just left.
  perform 1 from public.profiles where id = uid for no key update;
  if not found then raise exception 'not authenticated'; end if;
  if cid is distinct from public.my_couple_id()
    or (expected_couple_id is not null and expected_couple_id is distinct from cid) then
    raise exception 'WORKSPACE_CHANGED';
  end if;
  if target_kind is null or target_kind not in ('date', 'trip') then
    raise exception 'invalid plan kind';
  end if;
  if coalesce(jsonb_typeof(target_items), '') <> 'array' then
    raise exception 'plan items must be an array';
  end if;

  if jsonb_array_length(target_items) > 200 then raise exception 'too many plan items'; end if;
  -- Also serialize the first insertion, before a plan row exists to lock.
  perform pg_advisory_xact_lock(hashtextextended(cid::text || ':' || target_kind, 0));

  select * into saved_plan
  from public.plans
  where couple_id = cid and kind = target_kind
  for update;

  if not found then
    if expected_revision is not null and expected_revision <> 0 then
      raise exception 'PLAN_CONFLICT';
    end if;
    insert into public.plans (
      couple_id, kind, title, subtitle, start_date, day_count, revision_id
    ) values (
      cid,
      target_kind,
      coalesce(target_title, ''),
      coalesce(target_subtitle, ''),
      target_start_date,
      greatest(1, least(7, coalesce(target_day_count, 1))),
      1
    ) returning * into saved_plan;
    created := true;
  else
    if expected_revision is not null and expected_revision <> saved_plan.revision_id then
      raise exception 'PLAN_CONFLICT';
    end if;
    -- Save the previous dated journey in the same transaction before replacing it.
    if target_kind = 'trip' and saved_plan.start_date is distinct from target_start_date then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', coalesce(nullif(i.client_id, ''), i.id::text),
        'placeId', i.place_id, 'placeName', i.place_name, 'category', i.category,
        'startTime', i.start_time, 'durationMinutes', i.duration_minutes,
        'expectedCost', i.expected_cost, 'order', i.sort_order, 'memo', i.memo,
        'dayIndex', coalesce(i.day_index, 0),
        'coordinates', case when i.lng is not null and i.lat is not null then jsonb_build_array(i.lng, i.lat) else null end
      ) order by i.day_index, i.sort_order, i.id), '[]'::jsonb)
      from public.plan_items i where i.plan_id = saved_plan.id into draft_items;
      if draft_items <> '[]'::jsonb or btrim(saved_plan.subtitle) <> '' or btrim(saved_plan.title) not in ('', '우리가 고른 여행') then
        insert into public.trip_drafts (couple_id, scheduled_on, title, notes, day_count, items)
        values (cid, saved_plan.start_date, saved_plan.title, saved_plan.subtitle, saved_plan.day_count, draft_items)
        on conflict (couple_id, scheduled_on) do update
        set title=excluded.title, notes=excluded.notes, day_count=excluded.day_count, items=excluded.items
        where (public.trip_drafts.title, public.trip_drafts.notes, public.trip_drafts.day_count, public.trip_drafts.items)
          is distinct from (excluded.title, excluded.notes, excluded.day_count, excluded.items);
      end if;
    end if;
    update public.plans
    set title = coalesce(target_title, ''),
        subtitle = coalesce(target_subtitle, ''),
        start_date = target_start_date,
        day_count = greatest(1, least(7, coalesce(target_day_count, 1))),
        revision_id = revision_id + 1
    where id = saved_plan.id
    returning * into saved_plan;
  end if;

  delete from public.plan_items where plan_id = saved_plan.id;

  insert into public.plan_items (
    plan_id, client_id, place_id, place_name, category, start_time,
    duration_minutes, expected_cost, sort_order, memo, day_index, lng, lat
  )
  select
    saved_plan.id,
    item.client_id,
    coalesce(item.place_id, ''),
    item.place_name,
    coalesce(item.category, ''),
    coalesce(item.start_time, '09:30'),
    greatest(1, coalesce(item.duration_minutes, 60)),
    greatest(0, coalesce(item.expected_cost, 0)),
    coalesce(item.sort_order, 0),
    coalesce(item.memo, ''),
    greatest(0, least(6, coalesce(item.day_index, 0))),
    item.lng,
    item.lat
  from jsonb_to_recordset(target_items) as item(
    client_id text,
    place_id text,
    place_name text,
    category text,
    start_time text,
    duration_minutes integer,
    expected_cost integer,
    sort_order integer,
    memo text,
    day_index integer,
    lng double precision,
    lat double precision
  );

  if target_kind = 'trip' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', coalesce(nullif(i.client_id, ''), i.id::text),
        'placeId', i.place_id, 'placeName', i.place_name, 'category', i.category,
        'startTime', i.start_time, 'durationMinutes', i.duration_minutes,
        'expectedCost', i.expected_cost, 'order', i.sort_order, 'memo', i.memo,
        'dayIndex', coalesce(i.day_index, 0),
        'coordinates', case when i.lng is not null and i.lat is not null then jsonb_build_array(i.lng, i.lat) else null end
      ) order by i.day_index, i.sort_order, i.id), '[]'::jsonb)
      from public.plan_items i where i.plan_id = saved_plan.id into draft_items;
    if draft_items <> '[]'::jsonb or btrim(saved_plan.subtitle) <> '' or btrim(saved_plan.title) not in ('', '우리가 고른 여행') then
      insert into public.trip_drafts (couple_id, scheduled_on, title, notes, day_count, items)
      values (cid, saved_plan.start_date, saved_plan.title, saved_plan.subtitle, saved_plan.day_count, draft_items)
      on conflict (couple_id, scheduled_on) do update
        set title=excluded.title, notes=excluded.notes, day_count=excluded.day_count, items=excluded.items
        where (public.trip_drafts.title, public.trip_drafts.notes, public.trip_drafts.day_count, public.trip_drafts.items)
          is distinct from (excluded.title, excluded.notes, excluded.day_count, excluded.items);
    else
      delete from public.trip_drafts where couple_id=cid and scheduled_on is not distinct from saved_plan.start_date;
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.plan_versions where plan_id = saved_plan.id;

  insert into public.plan_versions (
    couple_id, plan_id, plan_kind, version_number, snapshot,
    change_summary, created_by
  ) values (
    cid, saved_plan.id, target_kind, next_version, target_items,
    coalesce(target_summary, ''), uid
  );

  action_name := case
    when target_kind = 'trip' and created then 'TRIP_CREATED'
    when target_kind = 'trip' then 'TRIP_UPDATED'
    when created then 'DATE_CREATED'
    else 'DATE_UPDATED'
  end;
  action_title := case
    when target_kind = 'trip' and created then '여행 계획을 만들었어요'
    when target_kind = 'trip' then '여행 계획을 수정했어요'
    when created then '데이트 계획을 만들었어요'
    else '데이트 계획을 수정했어요'
  end;

  insert into public.activities (
    couple_id, actor_user_id, entity_type, entity_id, action,
    title, detail, after_value
  ) values (
    cid, uid, 'plan', saved_plan.id::text, action_name,
    action_title, coalesce(target_summary, ''), target_items
  );

  return jsonb_build_object(
    'plan_id', saved_plan.id,
    'version', next_version,
    'revision', saved_plan.revision_id,
    'created', created
  );
end;
$function$;

revoke execute on function public.save_couple_plan_atomic(text,text,text,date,integer,jsonb,text,bigint,uuid) from public, anon;
grant execute on function public.save_couple_plan_atomic(text,text,text,date,integer,jsonb,text,bigint,uuid) to authenticated;

-- Explicitly move the active journey; browsing a date never calls this function.
create or replace function public.reschedule_couple_trip(
  target_start_date date,
  expected_revision bigint,
  expected_target_updated_at timestamptz default null,
  expected_couple_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  cid uuid := public.my_couple_id();
  uid uuid := auth.uid();
  current_plan public.plans%rowtype;
  target_draft public.trip_drafts%rowtype;
  previous_date date;
  payload jsonb;
  result jsonb;
begin
  if uid is null or cid is null then raise exception 'not authenticated'; end if;
  perform 1 from public.profiles where id = uid for no key update;
  if not found then raise exception 'not authenticated'; end if;
  if cid is distinct from public.my_couple_id()
    or (expected_couple_id is not null and expected_couple_id is distinct from cid) then
    raise exception 'WORKSPACE_CHANGED';
  end if;
  if target_start_date is null then raise exception 'invalid trip date'; end if;
  perform pg_advisory_xact_lock(hashtextextended(cid::text || ':trip', 0));
  select * into current_plan from public.plans where couple_id=cid and kind='trip' for update;
  if not found or expected_revision is null or current_plan.revision_id <> expected_revision then raise exception 'PLAN_CONFLICT'; end if;
  previous_date := current_plan.start_date;
  if previous_date is distinct from target_start_date then
    select * into target_draft from public.trip_drafts where couple_id=cid and scheduled_on=target_start_date for update;
    if found and (expected_target_updated_at is null or target_draft.updated_at is distinct from expected_target_updated_at) then
      raise exception 'TRIP_DATE_OCCUPIED';
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', i.client_id, 'place_id', i.place_id, 'place_name', i.place_name,
    'category', i.category, 'start_time', i.start_time, 'duration_minutes', i.duration_minutes,
    'expected_cost', i.expected_cost, 'sort_order', i.sort_order, 'memo', i.memo,
    'day_index', i.day_index, 'lng', i.lng, 'lat', i.lat
  ) order by i.day_index, i.sort_order, i.id), '[]'::jsonb)
  into payload from public.plan_items i where i.plan_id=current_plan.id;
  result := public.save_couple_plan_atomic(
    'trip', current_plan.title, current_plan.subtitle, target_start_date,
    current_plan.day_count, payload, '여행 시작 날짜를 변경했어요', expected_revision, cid
  );
  if previous_date is distinct from target_start_date then
    delete from public.trip_drafts where couple_id=cid and scheduled_on is not distinct from previous_date;
  end if;
  return result;
end;
$$;
revoke execute on function public.reschedule_couple_trip(date,bigint,timestamptz,uuid) from public, anon;
grant execute on function public.reschedule_couple_trip(date,bigint,timestamptz,uuid) to authenticated;

