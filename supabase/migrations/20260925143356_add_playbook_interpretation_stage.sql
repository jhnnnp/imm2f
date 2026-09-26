alter table public.date_planning_playbook
  drop constraint if exists date_planning_playbook_stage_check;

alter table public.date_planning_playbook
  add constraint date_planning_playbook_stage_check
  check (stage in ('interpretation', 'discovery', 'selection', 'editing', 'response'));
