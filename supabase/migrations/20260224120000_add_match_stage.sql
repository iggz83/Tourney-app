-- Add match stage to support playoff rounds.
-- Idempotent: safe to re-run.

alter table public.tournament_matches
  add column if not exists stage text not null default 'REGULAR';

