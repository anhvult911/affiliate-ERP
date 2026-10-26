-- One task per account per claim.
--
-- docs/REVIEW.md P1-2: the daily budget was evaluated once per statement, so an
-- account sitting at 7/8 with five queued tasks saw `7 < 8` for all five and took
-- all five in a single call (the claim itself allows up to 25). The gap check had
-- the same shape: every row looked at the same `last_action_at` snapshot, so a batch
-- also skipped the 20-minute rhythm. That is exactly the "fastest way to lose an
-- account" the limits were added to prevent.
--
-- The fix is structural: rank eligible tasks per account and take only rank 1. One
-- claim can therefore return at most one task per account, and the next claim
-- re-evaluates the budget against the row the previous claim just updated. Across two
-- workers the same holds, because the UPDATE from the first claim commits before the
-- second statement's snapshot.
--
-- `for update of t skip locked` keeps the original concurrency behaviour: two workers
-- never take the same row, and a locked account's task simply loses this round.

create or replace function public.claim_comment_tasks(p_worker text, p_limit int default 5)
returns setof public.comment_tasks
language sql
security definer
set search_path = ''
as $$
  with eligible as (
    select
      t.id,
      row_number() over (
        partition by t.assigned_account_id
        order by (t.status = 'running') asc, t.approved_at asc nulls last, t.created_at asc
      ) as account_rank
      from public.comment_tasks t
     where (
             t.status = 'queued'
             or (
               t.status = 'running'
               and t.claimed_at < now() - interval '15 minutes'
               and t.attempt_count < 3
             )
           )
       and t.assigned_account_id is not null
       and t.matched_product_id is not null
       and exists (
             select 1
               from public.social_accounts a
              where a.id = t.assigned_account_id
                and a.status = 'active'
                and (a.cooldown_until is null or a.cooldown_until <= now())
                and a.browser_profile_id is not null
                -- Daily budget: completed comments in the last 24 hours.
                and (
                  select count(*)
                    from public.comment_tasks done
                   where done.assigned_account_id = a.id
                     and done.status = 'completed'
                     and done.executed_at >= now() - interval '24 hours'
                ) < a.daily_comment_limit
                -- Cooldown gap between two actions.
                and (
                  a.last_action_at is null
                  or a.last_action_at <= now() - make_interval(mins => a.min_action_gap_minutes)
                )
           )
       and (
             t.execution_mode <> 'seeding_2_accounts'
             or exists (
                  select 1
                    from public.social_accounts s
                   where s.id = t.secondary_account_id
                     and s.status = 'active'
                     and (s.cooldown_until is null or s.cooldown_until <= now())
                     and s.browser_profile_id is not null
                )
           )
  ),
  picked as (
    select t.id
      from public.comment_tasks t
      join eligible e on e.id = t.id and e.account_rank = 1
     order by (t.status = 'running') asc, t.approved_at asc nulls last, t.created_at asc
     limit greatest(least(p_limit, 25), 1)
       for update of t skip locked
  )
  update public.comment_tasks t
     set status = 'running',
         claimed_at = now(),
         claimed_by = p_worker,
         attempt_count = t.attempt_count + 1
    from picked
   where t.id = picked.id
  returning t.*;
$$;

comment on function public.claim_comment_tasks(text, int) is
  'Claims queued tasks, at most one per account per call (docs/REVIEW.md P1-2).';
