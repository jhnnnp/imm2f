-- Complete a partner disconnect as one transaction. Shared records stay with
-- the remaining member; no couples, places, plans, or memories are deleted.
set local lock_timeout = '5s';

create or replace function public.leave_couple()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  old_cid uuid;
  new_cid uuid;
  current_cid uuid;
  partner_id uuid;
  actor_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- All membership-changing RPCs take the caller's profile lock first, then
  -- the couple lock. Serialize accepts and disconnects for the same account.
  select coalesce(nullif(btrim(display_name), ''), '파트너') into actor_name
    from public.profiles where id = uid for no key update;
  if not found then
    raise exception 'profile not found';
  end if;

  select couple_id into old_cid
    from public.couple_members where user_id = uid;
  if old_cid is null then
    return public.ensure_own_couple();
  end if;

  -- Two partners disconnecting concurrently must not both remove themselves
  -- from the shared space. The second caller observes the remaining solo space.
  perform 1 from public.couples where id = old_cid for update;
  if not found then
    raise exception 'couple not found';
  end if;
  select couple_id into current_cid
    from public.couple_members where user_id = uid;
  if current_cid is distinct from old_cid then
    raise exception 'couple changed; retry';
  end if;

  select user_id into partner_id
    from public.couple_members
    where couple_id = old_cid and user_id <> uid
    limit 1;
  if partner_id is null then
    return old_cid;
  end if;

  delete from public.couple_members
    where user_id = uid and couple_id = old_cid;
  if not found then
    raise exception 'membership changed; retry';
  end if;

  insert into public.couples (name) values ('우리') returning id into new_cid;
  insert into public.couple_members (couple_id, user_id, role)
    values (new_cid, uid, 'owner');
  update public.couple_invites set status = 'revoked'
    where couple_id = old_cid and status = 'pending';

  insert into public.activities (
    couple_id, actor_user_id, entity_type, entity_id, action, title, detail
  ) values (
    old_cid, uid, 'couple', old_cid::text, 'PARTNER_LEFT',
    '파트너 연결이 해제됐어요', actor_name || '님이 공간에서 나갔어요'
  );
  insert into public.email_outbox (
    couple_id, recipient_user_id, subject, body, status
  ) values (
    old_cid, partner_id, '[ONLY US] 파트너 연결이 해제됐어요',
    actor_name || '님이 연결을 해제하고 공간에서 나갔어요.', 'queued'
  );

  return new_cid;
end;
$$;

revoke execute on function public.leave_couple() from public, anon;
grant execute on function public.leave_couple() to authenticated;
