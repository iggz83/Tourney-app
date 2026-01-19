-- Inter-Club Tournament Tracker - Supabase schema
-- Run this in Supabase SQL editor.

create table if not exists public.tournaments (
  id text primary key,
  state jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per match per tournament. This is the authoritative place for scores to support multi-scorer concurrency.
create table if not exists public.tournament_matches (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  match_id text not null,

  division_id text not null,
  round smallint not null,
  matchup_index smallint not null,
  event_type text not null,
  seed integer not null,
  court integer not null,
  club_a text not null,
  club_b text not null,

  score_a integer null,
  score_b integer null,
  completed_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tournament_id, match_id)
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tournaments_set_updated_at on public.tournaments;
create trigger tournaments_set_updated_at
before update on public.tournaments
for each row
execute function public.set_updated_at();

drop trigger if exists tournament_matches_set_updated_at on public.tournament_matches;
create trigger tournament_matches_set_updated_at
before update on public.tournament_matches
for each row
execute function public.set_updated_at();

-- Realtime needs replica identity for "new" row in change payloads
alter table public.tournaments replica identity full;
alter table public.tournament_matches replica identity full;

-- Ensure table is included in Realtime publication (if publication exists)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tournaments'
    ) then
      alter publication supabase_realtime add table public.tournaments;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tournament_matches'
    ) then
      alter publication supabase_realtime add table public.tournament_matches;
    end if;
  end if;
end $$;

-- Enable RLS (we'll add policies below)
alter table public.tournaments enable row level security;
alter table public.tournament_matches enable row level security;

-- WARNING: These policies are permissive (link-based access).
-- Anyone who knows a tournament id can read/write. For a private deployment, add auth.

drop policy if exists "tournaments_read_all" on public.tournaments;
create policy "tournaments_read_all"
on public.tournaments
for select
using (true);

drop policy if exists "tournaments_write_all" on public.tournaments;
create policy "tournaments_write_all"
on public.tournaments
for all
using (true)
with check (true);

drop policy if exists "tournament_matches_read_all" on public.tournament_matches;
create policy "tournament_matches_read_all"
on public.tournament_matches
for select
using (true);

drop policy if exists "tournament_matches_write_all" on public.tournament_matches;
create policy "tournament_matches_write_all"
on public.tournament_matches
for all
using (true)
with check (true);
