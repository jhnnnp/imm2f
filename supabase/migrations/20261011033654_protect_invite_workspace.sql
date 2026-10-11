-- Membership changes are serialized per account and couple. Joining an
-- invitation must never cascade-delete an existing personal workspace.
set local lock_timeout = '5s';

create or replace function public.ensure_own_couple()
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare cid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform 1 from public.profiles where id = uid for no key update;
  if not found then raise exception 'profile not found'; end if;
  select couple_id into cid from public.couple_members where user_id = uid;
  if cid is not null then return cid; end if;
  insert into public.couples (name) values ('우리') returning id into cid;
  insert into public.couple_members (couple_id, user_id, role) values (cid, uid, 'owner');
  return cid;
end;
$$;

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
    if exists (select 1 from public.places where couple_id = existing)
      or exists (select 1 from public.memories where couple_id = existing)
      or exists (select 1 from public.couple_notes where couple_id = existing)
      or exists (select 1 from public.taste_profiles where couple_id = existing)
      or exists (select 1 from public.couple_insights where couple_id = existing)
      or exists (select 1 from public.date_drafts where couple_id = existing)
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

create or replace function public.create_couple_invite()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  cid uuid; uid uuid := auth.uid();
  new_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  exp timestamptz := now() + interval '14 days';
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform 1 from public.profiles where id = uid for no key update;
  if not found then raise exception 'profile not found'; end if;
  cid := public.ensure_own_couple();
  perform 1 from public.couples where id = cid for update;
  if (select count(*) from public.couple_members where couple_id = cid) >= 2 then
    raise exception 'couple already has two members';
  end if;
  update public.couple_invites set status = 'revoked' where couple_id = cid and status = 'pending';
  insert into public.couple_invites (couple_id, inviter_id, token, expires_at) values (cid, uid, new_token, exp);
  return jsonb_build_object('token', new_token, 'expires_at', exp);
end;
$$;

revoke execute on function public.ensure_own_couple() from public, anon;
revoke execute on function public.accept_couple_invite(text) from public, anon;
revoke execute on function public.create_couple_invite() from public, anon;
grant execute on function public.ensure_own_couple() to authenticated;
grant execute on function public.accept_couple_invite(text) to authenticated;
grant execute on function public.create_couple_invite() to authenticated;
