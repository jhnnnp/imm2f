set local lock_timeout = '5s';

create table public.couple_folders (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  scope text not null check (scope in ('vault', 'places')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40 and name !~ '[[:cntrl:]]'),
  color text not null default 'sage' check (color in ('sage','blue','rose','sand','lavender')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, scope, id)
);
create unique index couple_folders_name_idx on public.couple_folders(couple_id, scope, lower(name));
create trigger couple_folders_updated_at before update on public.couple_folders for each row execute function public.set_updated_at();

create table public.couple_folder_items (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  scope text not null check (scope in ('vault', 'places')),
  folder_id uuid not null,
  place_id uuid references public.places(id) on delete cascade,
  note_id uuid references public.couple_notes(id) on delete cascade,
  item_id uuid generated always as (coalesce(place_id, note_id)) stored,
  check ((scope = 'places' and place_id is not null and note_id is null) or (scope = 'vault' and note_id is not null and place_id is null)),
  foreign key (couple_id, scope, folder_id) references public.couple_folders(couple_id, scope, id) on delete cascade,
  unique (couple_id, scope, item_id)
);
create index couple_folder_items_folder_idx on public.couple_folder_items(couple_id, scope, folder_id);
create index couple_folder_items_place_idx on public.couple_folder_items(place_id);
create index couple_folder_items_note_idx on public.couple_folder_items(note_id);

alter table public.couple_folders enable row level security;
alter table public.couple_folder_items enable row level security;
alter table public.couple_folders replica identity full;
alter table public.couple_folder_items replica identity full;
revoke all on public.couple_folders, public.couple_folder_items from public, anon, authenticated;
grant select, insert, delete on public.couple_folders, public.couple_folder_items to authenticated;
grant update(name, color) on public.couple_folders to authenticated;
grant update(folder_id) on public.couple_folder_items to authenticated;
grant all on public.couple_folders, public.couple_folder_items to service_role;
create policy folders_read on public.couple_folders for select to authenticated using (couple_id = (select public.my_couple_id()));
create policy folders_create on public.couple_folders for insert to authenticated with check (couple_id = (select public.my_couple_id()));
create policy folders_edit on public.couple_folders for update to authenticated using (couple_id = (select public.my_couple_id())) with check (couple_id = (select public.my_couple_id()));
create policy folders_delete on public.couple_folders for delete to authenticated using (couple_id = (select public.my_couple_id()));
create policy folder_items_read on public.couple_folder_items for select to authenticated using (couple_id = (select public.my_couple_id()));
create policy folder_items_create on public.couple_folder_items for insert to authenticated with check (
  couple_id = (select public.my_couple_id()) and
  ((scope = 'places' and exists(select 1 from public.places p where p.id = place_id and p.couple_id = couple_folder_items.couple_id)) or
   (scope = 'vault' and exists(select 1 from public.couple_notes n where n.id = note_id and n.couple_id = couple_folder_items.couple_id and n.kind = 'vault')))
);
create policy folder_items_edit on public.couple_folder_items for update to authenticated using (couple_id = (select public.my_couple_id())) with check (
  couple_id = (select public.my_couple_id()) and
  ((scope = 'places' and exists(select 1 from public.places p where p.id = place_id and p.couple_id = couple_folder_items.couple_id)) or
   (scope = 'vault' and exists(select 1 from public.couple_notes n where n.id = note_id and n.couple_id = couple_folder_items.couple_id and n.kind = 'vault')))
);
create policy folder_items_delete on public.couple_folder_items for delete to authenticated using (couple_id = (select public.my_couple_id()));

-- Validate the entire request and lock its resources before changing any assignment.
-- SECURITY INVOKER keeps the same couple RLS rules for RPC and direct Data API access.
create function public.move_couple_folder_items(p_scope text, p_item_ids uuid[], p_folder_id uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  target_couple uuid := public.my_couple_id();
  ids uuid[];
  matched integer;
begin
  if auth.uid() is null or target_couple is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_scope is null or p_scope not in ('vault','places') or coalesce(cardinality(p_item_ids),0) not between 1 and 500 or array_position(p_item_ids,null) is not null then
    raise exception 'Invalid folder request' using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_item_ids) x;
  if p_folder_id is not null then
    perform id from public.couple_folders where id = p_folder_id and couple_id = target_couple and scope = p_scope for key share;
    if not found then raise exception 'Folder unavailable' using errcode = '22023'; end if;
  end if;
  if p_scope = 'places' then
    perform id from public.places where id = any(ids) and couple_id = target_couple order by id for key share;
  else
    perform id from public.couple_notes where id = any(ids) and couple_id = target_couple and kind = 'vault' order by id for key share;
  end if;
  get diagnostics matched = row_count;
  if matched <> cardinality(ids) then raise exception 'Items unavailable' using errcode = '22023'; end if;
  if p_folder_id is null then
    delete from public.couple_folder_items where couple_id = target_couple and scope = p_scope and item_id = any(ids);
  else
    insert into public.couple_folder_items(couple_id, scope, folder_id, place_id, note_id)
    select target_couple, p_scope, p_folder_id, case when p_scope = 'places' then x end, case when p_scope = 'vault' then x end from unnest(ids) x
    on conflict (couple_id, scope, item_id) do update set folder_id = excluded.folder_id;
  end if;
  return cardinality(ids);
end;
$$;
revoke execute on function public.move_couple_folder_items(text,uuid[],uuid) from public, anon;
grant execute on function public.move_couple_folder_items(text,uuid[],uuid) to authenticated, service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.couple_folders, public.couple_folder_items;
  end if;
end $$;
