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
