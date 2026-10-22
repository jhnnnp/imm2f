-- Shared calendar dates. No personal dates are seeded by this migration.
set local lock_timeout = '5s';

create function public.valid_couple_birthdays(entries jsonb)
returns boolean language plpgsql stable
set search_path = pg_catalog, public
as $$
declare entry jsonb; seen text[] := '{}'; parsed date; entry_id text;
begin
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) > 2 then return false; end if;
  for entry in select value from jsonb_array_elements(entries) loop
    entry_id := entry ->> 'id';
    if jsonb_typeof(entry) is distinct from 'object' or entry_id is null
      or entry_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or entry_id = any(seen) or jsonb_typeof(entry -> 'name') is distinct from 'string'
      or length(btrim(entry ->> 'name')) not between 1 and 60
      or jsonb_typeof(entry -> 'date') is distinct from 'string'
      or (entry ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    parsed := (entry ->> 'date')::date;
    if parsed < date '1900-01-01' or parsed > (now() at time zone 'Asia/Seoul')::date
      or to_char(parsed, 'YYYY-MM-DD') <> entry ->> 'date' then return false; end if;
    seen := array_append(seen, entry_id);
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.couple_key_dates (
  couple_id uuid primary key references public.couples(id) on delete cascade,
  relationship_started_on date,
  birthdays jsonb not null default '[]'::jsonb check (public.valid_couple_birthdays(birthdays)),
  revision bigint not null default 1 check (revision >= 1),
  onboarding_completed boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (relationship_started_on is null or relationship_started_on between date '1900-01-01' and (now() at time zone 'Asia/Seoul')::date)
);
create index couple_key_dates_updated_by_idx on public.couple_key_dates(updated_by);
alter table public.couple_key_dates enable row level security;
revoke all on public.couple_key_dates from public, anon, authenticated;
grant select, insert, update on public.couple_key_dates to authenticated;
grant all on public.couple_key_dates to service_role;
create policy couple_key_dates_select on public.couple_key_dates for select to authenticated
  using (public.is_couple_member(couple_id));
create policy couple_key_dates_insert on public.couple_key_dates for insert to authenticated
  with check (public.is_couple_member(couple_id) and updated_by = (select auth.uid()));
create policy couple_key_dates_update on public.couple_key_dates for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id) and updated_by = (select auth.uid()));

create function public.save_couple_key_dates(target_couple uuid, expected_revision bigint,
  started_on date, birthday_entries jsonb, complete_onboarding boolean default true)
returns setof public.couple_key_dates language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare current_revision bigint; result public.couple_key_dates%rowtype; entry jsonb;
begin
  if auth.uid() is null or not public.is_couple_member(target_couple) then raise exception 'not authorized'; end if;
  if expected_revision is null or expected_revision < 0 or complete_onboarding is null
    or birthday_entries is null or not public.valid_couple_birthdays(birthday_entries) then raise exception 'invalid key dates'; end if;
  for entry in select value from jsonb_array_elements(birthday_entries) loop
    if (entry ->> 'date')::date > (now() at time zone 'Asia/Seoul')::date then raise exception 'invalid birthday'; end if;
  end loop;
  -- Membership-changing functions lock this same row. Serialize the first
  -- insert, concurrent edits, and a disconnect without trusting UI order.
  perform 1 from public.couples where id = target_couple for update;
  if not found or not public.is_couple_member(target_couple) then raise exception 'not authorized'; end if;
  select * into result from public.couple_key_dates where couple_id = target_couple;
  current_revision := result.revision;
  if coalesce(current_revision, 0) <> expected_revision then
    -- A successful commit can lose its response. An exact retry returns the
    -- committed version without incrementing or duplicating calendar entries.
    if result.couple_id is not null and result.relationship_started_on is not distinct from started_on
      and result.birthdays = birthday_entries and result.onboarding_completed = complete_onboarding then
      return next result; return;
    end if;
    raise exception 'key dates conflict';
  end if;
  insert into public.couple_key_dates(couple_id, relationship_started_on, birthdays, revision, onboarding_completed, updated_by, updated_at)
    values (target_couple, started_on, birthday_entries, expected_revision + 1, complete_onboarding, auth.uid(), clock_timestamp())
    on conflict (couple_id) do update set relationship_started_on = excluded.relationship_started_on,
      birthdays = excluded.birthdays, revision = excluded.revision, onboarding_completed = excluded.onboarding_completed,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
    returning * into result;
  return next result;
end;
$$;
revoke execute on function public.save_couple_key_dates(uuid, bigint, date, jsonb, boolean) from public, anon;
grant execute on function public.save_couple_key_dates(uuid, bigint, date, jsonb, boolean) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.couple_key_dates;
  end if;
end $$;

-- Preserve the latest invitation guards, including trip drafts, and treat
-- meaningful calendar dates as data that must never be silently stranded.
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
    if exists (select 1 from public.couple_key_dates where couple_id = existing
        and (relationship_started_on is not null or jsonb_array_length(birthdays) > 0))
      or exists (select 1 from public.places where couple_id = existing)
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
