create schema if not exists extensions;
create extension if not exists vector with schema extensions;

alter table public.date_planning_playbook
  add column if not exists embedding extensions.vector(512),
  add column if not exists embedding_model text;

-- The playbook is small enough for an exact scan. Keep the stage predicate in
-- the function, before LIMIT, so semantic matches are selected within stage.
create or replace function public.match_date_playbook(
  query_embedding extensions.vector(512),
  target_stage text,
  match_count integer default 40
)
returns table (id text, similarity double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select p.id, (1 - (p.embedding <=> query_embedding))::double precision as similarity
  from public.date_planning_playbook p
  where p.active and p.embedding is not null
    and (target_stage is null or p.stage = target_stage)
    and p.embedding_model = 'text-embedding-3-small:512'
  order by p.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 100)
$$;

revoke all on function public.match_date_playbook(extensions.vector, text, integer) from public, anon, authenticated;
grant execute on function public.match_date_playbook(extensions.vector, text, integer) to service_role;
