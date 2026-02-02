-- Prevent score/schedule mutations once a tournament is marked complete.
-- This is a server-side safety net so older app builds / other devices cannot overwrite results.

-- Allow reading stays open (link-based access).
drop policy if exists "tournament_matches_write_all" on public.tournament_matches;

-- Only allow mutating match rows when the tournament is NOT locked.
-- We treat tournaments.state->>'tournamentLockedAt' being non-null as "locked".
create policy "tournament_matches_write_unlocked_only"
on public.tournament_matches
for all
using (
  exists (
    select 1
    from public.tournaments t
    where t.id = tournament_matches.tournament_id
      and coalesce(t.state->>'tournamentLockedAt','') = ''
  )
)
with check (
  exists (
    select 1
    from public.tournaments t
    where t.id = tournament_matches.tournament_id
      and coalesce(t.state->>'tournamentLockedAt','') = ''
  )
);

