-- Inter-Club Tournament Tracker - Supabase schema
-- Run this in Supabase SQL editor.

create table if not exists public.tournaments (
  id text primary key,
  state jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

-- Realtime needs replica identity for "new" row in change payloads
alter table public.tournaments replica identity full;

-- Enable RLS (we'll add policies below)
alter table public.tournaments enable row level security;

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

