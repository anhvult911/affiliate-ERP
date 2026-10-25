-- Per-account daily caps.
--
-- Before this, the only limits were the 15-minute lease and `attempt_count < 3`.
-- A queue of fifty approved tasks would therefore let one account post fifty
-- comments in an afternoon — the single fastest way to lose it, and nothing a
-- fingerprint can save. Volume is what platforms ban for.
--
-- Defaults are deliberately conservative for a solo operator warming accounts:
-- 8 comments/day, 4 warming actions/day, and at least 20 minutes between any two.

alter table public.social_accounts
  add column if not exists daily_comment_limit int not null default 8,
  add column if not exists daily_warming_limit int not null default 4,
  add column if not exists min_action_gap_minutes int not null default 20;

alter table public.social_accounts
  drop constraint if exists social_accounts_daily_comment_limit_check,
  drop constraint if exists social_accounts_daily_warming_limit_check,
  drop constraint if exists social_accounts_min_action_gap_check;

alter table public.social_accounts
  add constraint social_accounts_daily_comment_limit_check check (daily_comment_limit between 0 and 50),
  add constraint social_accounts_daily_warming_limit_check check (daily_warming_limit between 0 and 30),
  add constraint social_accounts_min_action_gap_check check (min_action_gap_minutes between 0 and 1440);

comment on column public.social_accounts.daily_comment_limit is
  'Max completed comments in a rolling 24h. 0 pauses the account without changing its status.';

-- ---------------------------------------------------------------------------
-- Claim: an account over its daily budget, or inside its cooldown gap, is not
-- eligible. The task stays queued for another account or another day instead of
-- failing (a failure would burn `attempt_count` for no reason).
-- ---------------------------------------------------------------------------
create or replace function public.claim_comment_tasks(p_worker text, p_limit int default 5)
returns setof public.comment_tasks
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select t.id
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
     order by (t.status = 'running') asc, t.approved_at asc nulls last, t.created_at asc
     limit greatest(least(p_limit, 25), 1)
       for update skip locked
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

-- ---------------------------------------------------------------------------
-- Rolling-24h usage per account: what the dashboard shows, and what the warming
-- scheduler stops on. `security_invoker` so an authenticated operator still reads
-- only rows their RLS allows.
--
-- Rehearsal runs (`sandbox`) are excluded: time spent on the local fixture must not
-- consume a real account's daily budget.
-- ---------------------------------------------------------------------------
create or replace view public.v_account_daily_usage
with (security_invoker = true) as
select
  a.id as account_id,
  (
    select count(*)::int
      from public.comment_tasks t
     where t.assigned_account_id = a.id
       and t.status = 'completed'
       and t.executed_at >= now() - interval '24 hours'
  ) as comments_24h,
  (
    select count(*)::int
      from public.warming_runs w
     where w.account_id = a.id
       and w.status = 'completed'
       and not w.sandbox
       and w.executed_at >= now() - interval '24 hours'
  ) as warming_24h,
  (
    select max(t.executed_at)
      from public.comment_tasks t
     where t.assigned_account_id = a.id
       and t.status = 'completed'
  ) as last_comment_at,
  (
    select max(w.executed_at)
      from public.warming_runs w
     where w.account_id = a.id
       and not w.sandbox
  ) as last_warming_at
from public.social_accounts a;
