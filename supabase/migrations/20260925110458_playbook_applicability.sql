alter table public.date_planning_playbook
  add column if not exists required_tags text[] not null default '{}',
  add column if not exists excluded_tags text[] not null default '{}';
