-- Read the authenticated user's profile and partner in one remote round trip.
-- SECURITY INVOKER preserves the existing profiles/couple_members RLS policies.
create or replace function public.app_session_snapshot()
returns table (
  couple_id uuid,
  display_name text,
  partner_user_id uuid,
  partner_display_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with my_couple as (select public.my_couple_id() as id)
  select
    my_couple.id,
    me.display_name,
    partner.user_id,
    partner_profile.display_name
  from my_couple
  left join public.profiles as me on me.id = auth.uid()
  left join lateral (
    select member.user_id
    from public.couple_members as member
    where member.couple_id = my_couple.id
      and member.user_id <> auth.uid()
    limit 1
  ) as partner on true
  left join public.profiles as partner_profile on partner_profile.id = partner.user_id;
$$;

revoke execute on function public.app_session_snapshot() from public, anon;
grant execute on function public.app_session_snapshot() to authenticated;
