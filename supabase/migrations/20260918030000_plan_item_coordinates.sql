-- Chatbot / discover stops need coordinates on the plan itself.
-- Previously the map only hydrated UUID rows from public.places.

alter table public.plan_items
  add column if not exists lng double precision,
  add column if not exists lat double precision;

create or replace function public.save_couple_plan_atomic(
  target_kind text,
  target_title text,
  target_subtitle text,
  target_start_date date,
  target_day_count integer,
  target_items jsonb,
  target_summary text,
  expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := public.my_couple_id();
  uid uuid := auth.uid();
  saved_plan public.plans%rowtype;
  created boolean := false;
  next_version integer;
  action_name text;
  action_title text;
begin
  if uid is null or cid is null then
    raise exception 'not authenticated';
  end if;
  if target_kind not in ('date', 'trip') then
    raise exception 'invalid plan kind';
  end if;
  if jsonb_typeof(target_items) <> 'array' then
    raise exception 'plan items must be an array';
  end if;

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
$$;
