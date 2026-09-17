drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities
  for delete to authenticated
  using (public.is_couple_member(couple_id));

grant delete on public.activities to authenticated;
