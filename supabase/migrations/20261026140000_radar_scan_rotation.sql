-- Radar: rotate the scanning account, give it a budget, and notice when it goes blind.
--
-- docs/REVIEW.md P1-3. The scan endpoint ordered accounts by `trust_score desc,
-- last_action_at asc` and nothing ever recorded that a scan happened, so the
-- highest-trust account scanned every source on every cycle, all day — the account
-- worth the most carried all the risk. The daily limits covered comments and warming
-- only. And a dead selector produced silence: no posts, no alert, radar blind until
-- someone noticed the empty queue.
--
-- `last_scanned_at` is deliberately a separate column from `last_action_at`: scanning
-- must rotate the scanner without consuming the 20-minute comment gap.

alter table public.social_accounts
  add column if not exists last_scanned_at timestamptz,
  add column if not exists daily_scan_limit int not null default 24;

alter table public.social_accounts
  drop constraint if exists social_accounts_daily_scan_limit_check;

alter table public.social_accounts
  add constraint social_accounts_daily_scan_limit_check check (daily_scan_limit between 0 and 288);

comment on column public.social_accounts.daily_scan_limit is
  'Max radar scans in a rolling 24h. 0 stops this account from scanning without changing its status.';

-- One row per source scan: the audit trail the rotation and the blind-radar alert
-- both need. Small and append-only; pruned by the index scan below.
create table if not exists public.radar_scans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  source_id uuid references public.target_sources (id) on delete set null,
  posts_seen int not null check (posts_seen >= 0),
  created_at timestamptz not null default now()
);

create index if not exists radar_scans_account_time_idx
  on public.radar_scans (account_id, created_at desc);

alter table public.radar_scans enable row level security;

-- Same shape as the other tables: operators may read, writes come from the
-- service-role API (the worker) only.
drop policy if exists "operators read radar scans" on public.radar_scans;
create policy "operators read radar scans"
  on public.radar_scans for select to authenticated
  using (public.is_operator());

-- ---------------------------------------------------------------------------
-- Which account scans next: the one that has scanned least recently and still has
-- budget. `nulls first` puts accounts that have never scanned at the front.
-- ---------------------------------------------------------------------------
create or replace function public.scan_accounts(p_limit int default 1)
returns table (
  id uuid,
  name text,
  browser_profile_id text,
  proxy_ip text,
  trust_score int,
  scans_24h int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.name,
    a.browser_profile_id,
    a.proxy_ip,
    a.trust_score,
    (select count(*)::int from public.radar_scans s
      where s.account_id = a.id
        and s.created_at >= now() - interval '24 hours') as scans_24h
  from public.social_accounts a
  where a.status = 'active'
    and a.browser_profile_id is not null
    and (
      select count(*) from public.radar_scans s
       where s.account_id = a.id
         and s.created_at >= now() - interval '24 hours'
    ) < a.daily_scan_limit
  order by a.last_scanned_at asc nulls first, a.trust_score desc, a.id
  limit greatest(least(p_limit, 10), 1);
$$;

revoke all on function public.scan_accounts(int) from public, anon, authenticated;
grant execute on function public.scan_accounts(int) to service_role;

-- ---------------------------------------------------------------------------
-- How many scans in a row found nothing. A selector that stopped matching produces
-- exactly this pattern, so the app alerts when the streak crosses a threshold.
-- ---------------------------------------------------------------------------
create or replace function public.radar_empty_streak()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with recent as (
    select posts_seen,
           row_number() over (order by created_at desc, id desc) as position
      from public.radar_scans
     order by created_at desc, id desc
     limit 20
  ),
  first_hit as (
    select coalesce(min(position), 21) as position from recent where posts_seen > 0
  )
  select count(*)::int
    from recent, first_hit
   where recent.position < first_hit.position;
$$;

revoke all on function public.radar_empty_streak() from public, anon, authenticated;
grant execute on function public.radar_empty_streak() to service_role;
