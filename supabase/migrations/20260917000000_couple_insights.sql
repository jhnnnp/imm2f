create table if not exists public.couple_insights (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  input_hash text not null,
  analysis_version text not null default 'taste-v2',
  model text not null default '',
  result jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists couple_insights_latest_idx
  on public.couple_insights(couple_id, created_at desc);

alter table public.couple_insights enable row level security;

create policy couple_insights_select on public.couple_insights
  for select to authenticated
  using (public.is_couple_member(couple_id));

create policy couple_insights_insert on public.couple_insights
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and created_by = auth.uid());

grant select, insert on public.couple_insights to authenticated;
