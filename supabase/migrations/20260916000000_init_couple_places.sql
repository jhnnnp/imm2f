-- Couple-scoped schema for ONLY US.
-- Apply in Supabase SQL editor, or with `supabase db push` after linking the project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  name text,
  revision_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'partner' check (role in ('owner', 'partner')),
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

create unique index if not exists couple_members_user_unique on public.couple_members(user_id);

create table if not exists public.couple_invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null,
  category text not null check (category in ('restaurant', 'cafe', 'nature', 'photo', 'book')),
  category_label text not null,
  district text not null default '',
  description text not null default '',
  duration_minutes integer not null default 60,
  expected_cost_two integer not null default 0,
  lng double precision,
  lat double precision,
  image text,
  visual_tone text not null default 'green' check (visual_tone in ('photo', 'blue', 'brown', 'green')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists places_couple_id_idx on public.places(couple_id);

create table if not exists public.place_preferences (
  place_id uuid not null references public.places(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'neutral' check (status in (
    'visited', 'want', 'must_visit', 'revisit', 'neutral', 'dislike', 'not_interested'
  )),
  fit integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (place_id, user_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists places_set_updated_at on public.places;
create trigger places_set_updated_at
  before update on public.places
  for each row execute function public.set_updated_at();

drop trigger if exists place_preferences_set_updated_at on public.place_preferences;
create trigger place_preferences_set_updated_at
  before update on public.place_preferences
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1), '우리')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_couple_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select couple_id from public.couple_members where user_id = auth.uid() limit 1
$$;

create or replace function public.is_couple_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target and user_id = auth.uid()
  )
$$;

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

create or replace function public.create_couple_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  uid uuid := auth.uid();
  member_count integer;
  new_token text := encode(gen_random_bytes(24), 'hex');
  exp timestamptz := now() + interval '14 days';
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  cid := public.my_couple_id();
  if cid is null then
    cid := public.ensure_own_couple();
  end if;

  select count(*) into member_count from public.couple_members where couple_id = cid;
  if member_count >= 2 then
    raise exception 'couple already has two members';
  end if;

  update public.couple_invites
    set status = 'revoked'
    where couple_id = cid and status = 'pending';

  insert into public.couple_invites (couple_id, inviter_id, token, expires_at)
  values (cid, uid, new_token, exp);

  return jsonb_build_object('token', new_token, 'expires_at', exp);
end;
$$;

create or replace function public.get_invite_preview(invite_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invite public.couple_invites%rowtype;
  inviter_name text;
  member_count integer;
begin
  select * into invite
  from public.couple_invites
  where token = invite_token;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if invite.status <> 'pending' or invite.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  select count(*) into member_count from public.couple_members where couple_id = invite.couple_id;
  if member_count >= 2 then
    return jsonb_build_object('valid', false, 'reason', 'full');
  end if;

  select display_name into inviter_name from public.profiles where id = invite.inviter_id;

  return jsonb_build_object(
    'valid', true,
    'inviter_name', coalesce(inviter_name, '파트너'),
    'expires_at', invite.expires_at
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

  select couple_id into existing from public.couple_members where user_id = uid;
  if existing is not null then
    if existing = invite.couple_id then
      return existing;
    end if;
    raise exception 'already in a couple';
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

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.couple_invites enable row level security;
alter table public.places enable row level security;
alter table public.place_preferences enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (
      public.my_couple_id() is not null
      and exists (
        select 1 from public.couple_members
        where couple_id = public.my_couple_id() and user_id = profiles.id
      )
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists couples_select on public.couples;
create policy couples_select on public.couples
  for select to authenticated
  using (id = public.my_couple_id());

drop policy if exists couples_update on public.couples;
create policy couples_update on public.couples
  for update to authenticated
  using (id = public.my_couple_id())
  with check (id = public.my_couple_id());

drop policy if exists couple_members_select on public.couple_members;
create policy couple_members_select on public.couple_members
  for select to authenticated
  using (couple_id = public.my_couple_id());

drop policy if exists couple_invites_select on public.couple_invites;
create policy couple_invites_select on public.couple_invites
  for select to authenticated
  using (couple_id = public.my_couple_id());

drop policy if exists places_select on public.places;
create policy places_select on public.places
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists places_insert on public.places;
create policy places_insert on public.places
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and created_by = auth.uid());

drop policy if exists places_update on public.places;
create policy places_update on public.places
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

drop policy if exists places_delete on public.places;
create policy places_delete on public.places
  for delete to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists place_preferences_select on public.place_preferences;
create policy place_preferences_select on public.place_preferences
  for select to authenticated
  using (
    exists (
      select 1 from public.places
      where places.id = place_preferences.place_id
        and public.is_couple_member(places.couple_id)
    )
  );

drop policy if exists place_preferences_insert on public.place_preferences;
create policy place_preferences_insert on public.place_preferences
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.places
      where places.id = place_id and public.is_couple_member(places.couple_id)
    )
  );

drop policy if exists place_preferences_update on public.place_preferences;
create policy place_preferences_update on public.place_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.couples, public.couple_members, public.couple_invites, public.places, public.place_preferences to authenticated;

grant execute on function public.my_couple_id() to authenticated;
grant execute on function public.is_couple_member(uuid) to authenticated;
grant execute on function public.ensure_own_couple() to authenticated;
grant execute on function public.create_couple_invite() to authenticated;
grant execute on function public.accept_couple_invite(text) to authenticated;
grant execute on function public.get_invite_preview(text) to anon, authenticated;
