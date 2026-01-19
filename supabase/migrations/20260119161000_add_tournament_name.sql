-- Add a human-friendly tournament name for UI lists.
-- Safe to run multiple times.

alter table public.tournaments
add column if not exists name text not null default '';

