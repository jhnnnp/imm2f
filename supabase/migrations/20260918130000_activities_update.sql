drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

grant update on public.activities to authenticated;

alter table public.activities replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.activities;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
