drop trigger if exists seed_demo_places_on_couple on public.couples;
drop trigger if exists trg_seed_demo_places on public.couples;
drop trigger if exists seed_demo_places_on_member on public.couple_members;
drop function if exists public.seed_demo_places(uuid, uuid);
drop function if exists public.seed_demo_places();

delete from public.places
where external_source = 'manual'
  and external_place_id is null
  and (name, lng, lat) in (
    ('카페 라파르', 126.7086, 35.9879),
    ('초원사진관', 126.7108, 35.9892),
    ('은파호수공원', 126.6894, 35.9553),
    ('이성당', 126.7116, 35.9871),
    ('마리서사', 126.7049, 35.9898),
    ('한주옥', 126.7082, 35.9906)
  );

create or replace function public.leave_couple()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  old_cid uuid;
  new_cid uuid;
  remaining integer;
  partner_id uuid;
  actor_name text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select couple_id into old_cid from public.couple_members where user_id = uid;
  if old_cid is null then
    return public.ensure_own_couple();
  end if;

  select count(*) into remaining from public.couple_members where couple_id = old_cid;
  if remaining <= 1 then
    return old_cid;
  end if;

  select user_id into partner_id
    from public.couple_members
    where couple_id = old_cid and user_id <> uid
    limit 1;
  select coalesce(nullif(trim(display_name), ''), '파트너') into actor_name
    from public.profiles where id = uid;
  if actor_name is null then
    actor_name := '파트너';
  end if;

  insert into public.activities (
    couple_id, actor_user_id, entity_type, entity_id, action, title, detail
  ) values (
    old_cid,
    uid,
    'couple',
    old_cid::text,
    'PARTNER_LEFT',
    '파트너 연결이 해제됐어요',
    actor_name || '님이 공간에서 나갔어요'
  );

  if partner_id is not null then
    insert into public.email_outbox (
      couple_id, recipient_user_id, subject, body, status
    ) values (
      old_cid,
      partner_id,
      '[ONLY US] 파트너 연결이 해제됐어요',
      actor_name || '님이 연결을 해제하고 공간에서 나갔어요.',
      'queued'
    );
  end if;

  delete from public.couple_members where user_id = uid and couple_id = old_cid;
  update public.couple_invites
    set status = 'revoked'
    where couple_id = old_cid and status = 'pending';

  insert into public.couples (name) values ('우리') returning id into new_cid;
  insert into public.couple_members (couple_id, user_id, role)
  values (new_cid, uid, 'owner');
  return new_cid;
end;
$$;

grant execute on function public.leave_couple() to authenticated;
