-- Dated trip workspaces survive date browsing and active-plan replacement.
set local lock_timeout = '5s';
create table public.trip_drafts (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  scheduled_on date,
  title text not null default '',
  notes text not null default '',
  day_count integer not null default 1 check (day_count between 1 and 7),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (couple_id, scheduled_on)
);
create trigger trip_drafts_set_updated_at before update on public.trip_drafts
for each row execute function public.set_updated_at();
alter table public.trip_drafts enable row level security;
create policy trip_drafts_select on public.trip_drafts for select to authenticated
using (couple_id = (select public.my_couple_id()));
revoke all on public.trip_drafts from public, anon, authenticated;
grant select on public.trip_drafts to authenticated;
grant all on public.trip_drafts to service_role;
alter table public.trip_drafts replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.trip_drafts;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.save_couple_plan_atomic(target_kind text, target_title text, target_subtitle text, target_start_date date, target_day_count integer, target_items jsonb, target_summary text, expected_revision bigint DEFAULT NULL::bigint)
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
        on conflict (couple_id, scheduled_on) do update set title=excluded.title, notes=excluded.notes, day_count=excluded.day_count, items=excluded.items;
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
      on conflict (couple_id, scheduled_on) do update set title=excluded.title, notes=excluded.notes, day_count=excluded.day_count, items=excluded.items;
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

revoke execute on function public.save_couple_plan_atomic(text,text,text,date,integer,jsonb,text,bigint) from public, anon;
grant execute on function public.save_couple_plan_atomic(text,text,text,date,integer,jsonb,text,bigint) to authenticated;

-- Explicitly move the active journey; browsing a date never calls this function.
create or replace function public.reschedule_couple_trip(
  target_start_date date,
  expected_revision bigint,
  expected_target_updated_at timestamptz default null
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
    current_plan.day_count, payload, '여행 시작 날짜를 변경했어요', expected_revision
  );
  if previous_date is distinct from target_start_date then
    delete from public.trip_drafts where couple_id=cid and scheduled_on is not distinct from previous_date;
  end if;
  return result;
end;
$$;
revoke execute on function public.reschedule_couple_trip(date,bigint,timestamptz) from public, anon;
grant execute on function public.reschedule_couple_trip(date,bigint,timestamptz) to authenticated;

-- Preserve the currently active saved trip before date browsing becomes available.
insert into public.trip_drafts(couple_id,scheduled_on,title,notes,day_count,items,updated_at)
select p.couple_id,p.start_date,p.title,p.subtitle,p.day_count,
  coalesce(s.items,'[]'::jsonb), p.updated_at
from public.plans p
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'id', coalesce(nullif(i.client_id,''),i.id::text),
    'placeId', i.place_id, 'placeName', i.place_name, 'category', i.category,
    'startTime', i.start_time, 'durationMinutes', i.duration_minutes,
    'expectedCost', i.expected_cost, 'order', i.sort_order, 'memo', i.memo,
    'dayIndex', coalesce(i.day_index,0),
    'coordinates', case when i.lng is not null and i.lat is not null then jsonb_build_array(i.lng,i.lat) else null end
  ) order by i.day_index,i.sort_order,i.id) as items from public.plan_items i where i.plan_id=p.id
) s on true
where p.kind='trip' and (coalesce(s.items,'[]'::jsonb)<>'[]'::jsonb or btrim(p.subtitle)<>'' or btrim(p.title) not in ('','우리가 고른 여행'))
on conflict (couple_id,scheduled_on) do nothing;
-- Named folders are saved personal workspace data, including empty folders.
-- Accepting a partner invitation must not strand them in the previous space.


create or replace function public.accept_couple_invite(invite_token text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  invite public.couple_invites%rowtype;
  uid uuid := auth.uid();
  existing uuid;
  solo_count integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform 1 from public.profiles where id = uid for no key update;
  if not found then raise exception 'profile not found'; end if;

  select * into invite from public.couple_invites where token = invite_token;
  if not found then raise exception 'invite not found'; end if;
  if invite.inviter_id = uid then raise exception 'own invite'; end if;
  select couple_id into existing from public.couple_members where user_id = uid;

  -- Lock both spaces in a stable order even for reciprocal invitations.
  perform 1 from public.couples
    where id = invite.couple_id or id = existing order by id for update;
  select * into invite from public.couple_invites where token = invite_token for update;
  if not found then raise exception 'invite not found'; end if;
  select couple_id into existing from public.couple_members where user_id = uid;
  -- A lost response may retry an already completed acceptance.
  if existing = invite.couple_id then return existing; end if;
  if invite.status <> 'pending' or invite.expires_at <= now() then raise exception 'invite expired'; end if;
  if not exists (select 1 from public.couple_members
    where couple_id = invite.couple_id and user_id = invite.inviter_id) then
    raise exception 'invite expired';
  end if;
  if (select count(*) from public.couple_members where couple_id = invite.couple_id) >= 2 then
    raise exception 'couple already has two members';
  end if;

  if existing is not null then
    select count(*) into solo_count from public.couple_members where couple_id = existing;
    if solo_count <> 1 then raise exception 'already in a couple'; end if;
    -- Lock editable empty plans before checking whether they became meaningful.
    perform 1 from public.plans where couple_id = existing for update;
    perform 1 from public.date_drafts where couple_id = existing for update;
    perform 1 from public.trip_drafts where couple_id = existing for update;
    if exists (select 1 from public.places where couple_id = existing)
      or exists (select 1 from public.memories where couple_id = existing)
      or exists (select 1 from public.couple_notes where couple_id = existing)
      or exists (select 1 from public.couple_folders where couple_id = existing)
      or exists (select 1 from public.taste_profiles where couple_id = existing)
      or exists (select 1 from public.couple_insights where couple_id = existing)
      or exists (select 1 from public.date_drafts where couple_id = existing)
      or exists (select 1 from public.trip_drafts where couple_id = existing)
      or exists (select 1 from public.plans p where p.couple_id = existing and (
        btrim(coalesce(p.subtitle, '')) <> ''
        or btrim(coalesce(p.title, '')) not in ('', '우리가 고른 데이트', '우리가 고른 여행')
        or exists (select 1 from public.plan_items i where i.plan_id = p.id)))
      or exists (select 1 from public.memory_wall_boards where couple_id = existing and (
        coalesce(state -> 'poses', '{}'::jsonb) <> '{}'::jsonb
        or coalesce(state -> 'strokes', '[]'::jsonb) <> '[]'::jsonb
        or coalesce(state -> 'texts', '[]'::jsonb) <> '[]'::jsonb)) then
      raise exception 'solo workspace has saved data';
    end if;
    delete from public.couple_members where user_id = uid and couple_id = existing;
    -- Keep the old couple row: no record or uploaded file is deleted implicitly.
  end if;

  insert into public.couple_members (couple_id, user_id, role) values (invite.couple_id, uid, 'partner');
  update public.couple_invites set status = 'accepted' where id = invite.id;
  return invite.couple_id;
end;
$$;

revoke execute on function public.accept_couple_invite(text) from public, anon;
grant execute on function public.accept_couple_invite(text) to authenticated;
