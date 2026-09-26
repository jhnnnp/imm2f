-- Curated decision knowledge for the date planner. This is deliberately small:
-- live venue, route and event facts belong to their own provider-backed stores.
create table if not exists public.date_planning_playbook (
  id text primary key,
  version integer not null check (version > 0),
  title text not null check (length(title) between 3 and 100),
  stage text not null check (stage in ('discovery', 'selection', 'editing', 'response')),
  tags text[] not null default '{}',
  guidance text not null check (length(guidance) between 20 and 1200),
  example text not null default '',
  priority smallint not null default 50 check (priority between 0 and 100),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists date_planning_playbook_tags_idx
  on public.date_planning_playbook using gin (tags);
create index if not exists date_planning_playbook_stage_idx
  on public.date_planning_playbook (stage, active, priority desc);

alter table public.date_planning_playbook enable row level security;
revoke all on public.date_planning_playbook from anon, authenticated;
