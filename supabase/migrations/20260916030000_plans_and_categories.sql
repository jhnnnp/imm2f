-- TourAPI categories on saved places, plus couple-scoped date/trip drafts.

alter table public.places drop constraint if exists places_category_check;
alter table public.places
  add constraint places_category_check
  check (category in (
    'restaurant', 'cafe', 'nature', 'photo', 'book', 'tourist', 'festival', 'stay'
  ));

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null check (kind in ('date', 'trip')),
  title text not null default '',
  subtitle text not null default '',
  updated_at timestamptz not null default now(),
  unique (couple_id, kind)
);

create table if not exists public.plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  client_id text not null,
  place_id text not null default '',
  place_name text not null,
  category text not null default '',
  start_time text not null default '09:30',
  duration_minutes integer not null default 60,
  expected_cost integer not null default 0,
  sort_order integer not null default 0,
  memo text not null default ''
);

create index if not exists plans_couple_id_idx on public.plans(couple_id);
create index if not exists plan_items_plan_id_idx on public.plan_items(plan_id, sort_order);

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;
alter table public.plan_items enable row level security;

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists plans_insert on public.plans;
create policy plans_insert on public.plans
  for insert to authenticated
  with check (public.is_couple_member(couple_id));

drop policy if exists plans_update on public.plans;
create policy plans_update on public.plans
  for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

drop policy if exists plans_delete on public.plans;
create policy plans_delete on public.plans
  for delete to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists plan_items_select on public.plan_items;
create policy plan_items_select on public.plan_items
  for select to authenticated
  using (
    exists (
      select 1 from public.plans
      where plans.id = plan_items.plan_id
        and public.is_couple_member(plans.couple_id)
    )
  );

drop policy if exists plan_items_insert on public.plan_items;
create policy plan_items_insert on public.plan_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.plans
      where plans.id = plan_id
        and public.is_couple_member(plans.couple_id)
    )
  );

drop policy if exists plan_items_update on public.plan_items;
create policy plan_items_update on public.plan_items
  for update to authenticated
  using (
    exists (
      select 1 from public.plans
      where plans.id = plan_items.plan_id
        and public.is_couple_member(plans.couple_id)
    )
  )
  with check (
    exists (
      select 1 from public.plans
      where plans.id = plan_id
        and public.is_couple_member(plans.couple_id)
    )
  );

drop policy if exists plan_items_delete on public.plan_items;
create policy plan_items_delete on public.plan_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.plans
      where plans.id = plan_items.plan_id
        and public.is_couple_member(plans.couple_id)
    )
  );

grant select, insert, update, delete on public.plans, public.plan_items to authenticated;
