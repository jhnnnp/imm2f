-- Restore verified workspace schema drift without changing existing user rows.
-- Repair activity delivery/policies, coordinate persistence and account isolation.
set local lock_timeout = '5s';

alter table public.activities replica identity full;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'activities_update') then
    execute 'create policy activities_update on public.activities for update to authenticated using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'activities_delete') then
    execute 'create policy activities_delete on public.activities for delete to authenticated using (public.is_couple_member(couple_id))';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activities') then
    alter publication supabase_realtime add table public.activities;
  end if;
end;
$$;
grant update, delete on public.activities to authenticated;
alter function public.set_updated_at() set search_path = pg_catalog;

-- Remove obsolete automatic demo creation without deleting existing user data.
-- This is the actual remote definition with only its seed_demo_places call removed.
create or replace function public.ensure_own_couple()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select couple_id into cid from public.couple_members where user_id = uid;
  if cid is not null then
    return cid;
  end if;

  insert into public.couples (name) values ('우리') returning id into cid;
  insert into public.couple_members (couple_id, user_id, role) values (cid, uid, 'owner');
  return cid;
end;
$$;

-- The legacy seeder takes arbitrary couple/user identifiers and performs privileged writes.
-- Keeping it defined avoids breaking any historical internal references.
revoke execute on function public.seed_demo_places(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ensure_own_couple() from public, anon;
grant execute on function public.ensure_own_couple() to authenticated;

-- Resolve all 11 auth_rls_initplan advisor findings while preserving policy roles/commands.
alter policy profiles_select on public.profiles using (
  id = (select auth.uid())
  or (
    (select public.my_couple_id()) is not null
    and exists (
      select 1 from public.couple_members
      where couple_members.couple_id = (select public.my_couple_id())
        and couple_members.user_id = profiles.id
    )
  )
);
alter policy profiles_update on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy places_insert on public.places with check (
  public.is_couple_member(couple_id) and created_by = (select auth.uid())
);

alter policy place_preferences_insert on public.place_preferences with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.places
    where places.id = place_preferences.place_id
      and public.is_couple_member(places.couple_id)
  )
);
-- Match INSERT's parent ownership validation when place_id is changed by UPDATE.
alter policy place_preferences_update on public.place_preferences
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.places
      where places.id = place_preferences.place_id
        and public.is_couple_member(places.couple_id)
    )
  );

alter policy couple_insights_insert on public.couple_insights with check (
  public.is_couple_member(couple_id) and created_by = (select auth.uid())
);

alter policy taste_profiles_insert on public.taste_profiles with check (
  public.is_couple_member(couple_id) and user_id = (select auth.uid())
);
alter policy taste_profiles_update on public.taste_profiles
  using (public.is_couple_member(couple_id) and user_id = (select auth.uid()))
  with check (public.is_couple_member(couple_id) and user_id = (select auth.uid()));
alter policy taste_profiles_delete on public.taste_profiles using (
  public.is_couple_member(couple_id) and user_id = (select auth.uid())
);

alter policy memory_wall_boards_insert on public.memory_wall_boards with check (
  public.is_couple_member(couple_id) and updated_by = (select auth.uid())
);
alter policy memory_wall_boards_update on public.memory_wall_boards
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id) and updated_by = (select auth.uid()));

-- Existing indexes cover only couple_id (places), or lack entity_type (activities).
-- These match the application's startup list and archive/draft queries.
create index if not exists places_couple_created_idx
  on public.places (couple_id, created_at);
create index if not exists activities_couple_entity_created_idx
  on public.activities (couple_id, entity_type, created_at desc);
-- Invite creation revokes pending invites by couple/status; the FK currently has no index.
create index if not exists couple_invites_couple_status_idx
  on public.couple_invites (couple_id, status);

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

create or replace function public.accept_couple_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.couple_invites%rowtype;
  uid uuid := auth.uid();
  existing uuid;
  member_count integer;
  solo_count integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into invite from public.couple_invites where token = invite_token for update;
  if not found then
    raise exception 'invite not found';
  end if;
  if invite.status <> 'pending' or invite.expires_at <= now() then
    raise exception 'invite expired';
  end if;
  if invite.inviter_id = uid then
    raise exception 'own invite';
  end if;

  -- Serialize different invite tokens targeting the same two-person space.
  perform 1 from public.couples where id = invite.couple_id for update;

  select couple_id into existing from public.couple_members where user_id = uid;
  if existing is not null then
    if existing = invite.couple_id then
      return existing;
    end if;
    select count(*) into solo_count from public.couple_members where couple_id = existing;
    if solo_count = 1 then
      delete from public.couple_members where user_id = uid and couple_id = existing;
      delete from public.couples
        where id = existing
          and not exists (select 1 from public.couple_members where couple_id = existing);
    else
      raise exception 'already in a couple';
    end if;
  end if;

  select count(*) into member_count from public.couple_members where couple_id = invite.couple_id;
  if member_count >= 2 then
    raise exception 'couple already has two members';
  end if;

  insert into public.couple_members (couple_id, user_id, role)
  values (invite.couple_id, uid, 'partner');

  update public.couple_invites set status = 'accepted' where id = invite.id;
  return invite.couple_id;
end;
$$;

-- Authenticated RPCs retain their caller checks; preview remains publicly readable.
revoke execute on function public.save_couple_plan_atomic(text, text, text, date, integer, jsonb, text, bigint) from public, anon;
grant execute on function public.save_couple_plan_atomic(text, text, text, date, integer, jsonb, text, bigint) to authenticated;
revoke execute on function public.accept_couple_invite(text) from public, anon;
grant execute on function public.accept_couple_invite(text) to authenticated;
revoke execute on function public.create_couple_invite() from public, anon;
grant execute on function public.create_couple_invite() to authenticated;
