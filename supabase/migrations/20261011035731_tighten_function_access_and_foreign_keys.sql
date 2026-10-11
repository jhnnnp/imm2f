set local lock_timeout = '5s';

-- Trigger execution remains available to Auth. These functions need no public RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_couple_member(uuid) from public, anon;
revoke execute on function public.my_couple_id() from public, anon;
grant execute on function public.is_couple_member(uuid), public.my_couple_id() to authenticated, service_role;

-- Cover foreign-key lookups for member/account changes and workspace histories.
create index if not exists activities_actor_user_id_idx on public.activities(actor_user_id);
create index if not exists couple_insights_created_by_idx on public.couple_insights(created_by);
create index if not exists couple_invites_inviter_id_idx on public.couple_invites(inviter_id);
create index if not exists couple_notes_created_by_idx on public.couple_notes(created_by);
create index if not exists email_outbox_recipient_user_id_idx on public.email_outbox(recipient_user_id);
create index if not exists memories_created_by_idx on public.memories(created_by);
create index if not exists memories_place_id_idx on public.memories(place_id);
create index if not exists memory_wall_boards_updated_by_idx on public.memory_wall_boards(updated_by);
create index if not exists place_preferences_user_id_idx on public.place_preferences(user_id);
create index if not exists places_created_by_idx on public.places(created_by);
create index if not exists plan_versions_couple_id_idx on public.plan_versions(couple_id);
create index if not exists plan_versions_created_by_idx on public.plan_versions(created_by);
create index if not exists taste_profiles_user_id_idx on public.taste_profiles(user_id);
