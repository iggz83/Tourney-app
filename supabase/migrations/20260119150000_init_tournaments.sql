-- Inter-Club Tournament Tracker - Supabase migration
-- Idempotent: safe to re-run

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
  end if;
end $$;

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

