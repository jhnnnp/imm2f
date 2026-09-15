-- Collaboration: activities, plan versions, email outbox, solo-couple invite join.

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id text not null default '',
  action text not null,
  title text not null default '',
  detail text not null default '',
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activities_couple_created_idx
  on public.activities(couple_id, created_at desc);

create table if not exists public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  plan_kind text not null check (plan_kind in ('date', 'trip')),
  version_number integer not null,
  snapshot jsonb not null default '[]'::jsonb,
  change_summary text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, version_number)
);

create index if not exists plan_versions_plan_idx
  on public.plan_versions(plan_id, version_number desc);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  recipient_user_id uuid references public.profiles(id) on delete set null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  created_at timestamptz not null default now()
);

create index if not exists email_outbox_couple_created_idx
  on public.email_outbox(couple_id, created_at desc);

alter table public.activities enable row level security;
alter table public.plan_versions enable row level security;
alter table public.email_outbox enable row level security;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

drop policy if exists plan_versions_select on public.plan_versions;
create policy plan_versions_select on public.plan_versions
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists plan_versions_insert on public.plan_versions;
create policy plan_versions_insert on public.plan_versions
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select on public.email_outbox
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists email_outbox_insert on public.email_outbox;
create policy email_outbox_insert on public.email_outbox
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

grant select, insert on public.activities, public.plan_versions, public.email_outbox to authenticated;

-- Allow a solo couple member to leave their empty space and join an invite.
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
-- Token generation without pgcrypto dependency.
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
  new_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
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
