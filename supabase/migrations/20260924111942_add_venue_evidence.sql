-- Shared public venue facts. Writes come only from the server after source,
-- excerpt and exact-branch checks. User/couple data must never be stored here.
create table if not exists public.venue_evidence (
  id text primary key,
  external_source text not null check (external_source in ('kakao', 'tourapi')),
  external_place_id text not null,
  branch_name text not null,
  venue_address text not null,
  attribute text not null check (attribute in ('space', 'menu', 'experience')),
  observation text not null,
  source_url text not null,
  source_excerpt text not null,
  source_venue_name text not null,
  source_address text not null,
  verification text not null check (verification in ('search_report', 'source_checked')),
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists venue_evidence_place_idx
  on public.venue_evidence (external_source, external_place_id, checked_at desc);

alter table public.venue_evidence enable row level security;
-- No anon/authenticated policy or grant: service-role server code is the only
-- writer and reader. This prevents user-authored text poisoning the corpus.
revoke all on public.venue_evidence from anon, authenticated;
