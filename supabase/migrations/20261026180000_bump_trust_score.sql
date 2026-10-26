-- Atomic trust increments.
--
-- docs/REVIEW.md P2-6. Both report routes read `trust_score`, added 1 in JS and wrote
-- the absolute value back. Two reports finishing at the same time (two workers, or the
-- primary and secondary account of a 2-tier task) read the same starting value and one
-- of the two increments is silently lost. Trust drives assignment order, so losing
-- increments quietly changes which account gets work.
--
-- A single UPDATE with `trust_score = trust_score + delta` lets Postgres serialise the
-- two writers; the clamp keeps the column inside 0..100 as the check constraint
-- requires.
--
-- Rollback: drop the function. Callers can fall back to reading the value, but the
-- read-modify-write was the bug.

create or replace function public.bump_trust_score(p_account_id uuid, p_delta int default 1)
returns int
language sql
security definer
set search_path = ''
as $$
  update public.social_accounts
     set trust_score = least(100, greatest(0, trust_score + p_delta)),
         updated_at = now()
   where id = p_account_id
  returning trust_score;
$$;

revoke all on function public.bump_trust_score(uuid, int) from public, anon, authenticated;
grant execute on function public.bump_trust_score(uuid, int) to service_role;

comment on function public.bump_trust_score(uuid, int) is
  'Atomic trust increment/decrement, clamped to 0..100 (docs/REVIEW.md P2-6).';
