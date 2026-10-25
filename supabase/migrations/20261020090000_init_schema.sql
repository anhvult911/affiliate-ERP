-- =============================================================================
-- In-house Affiliate Automation & Social Hub — initial schema
-- Module map (Phân hệ): 1&2 accounts/persona-warming, 3 target sources,
--                       4 products/affiliate pool, 5&6 radar + approval queue,
--                       7 analytics & ROI.
--
-- Target: Supabase Postgres (pgcrypto, vector, pg_trgm, RLS, realtime).
-- The realtime publication is added inside an existence guard so this file also
-- applies cleanly to a bare Postgres instance (used by CI schema validation).
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- -----------------------------------------------------------------------------
-- Enumerated types (contract shared with src/lib/constants.ts and the workers)
-- -----------------------------------------------------------------------------
create type public.social_platform as enum ('facebook', 'instagram', 'tiktok', 'threads');

create type public.account_status as enum ('active', 'cooldown', 'checkpoint');

create type public.source_type as enum ('group', 'fanpage', 'kol', 'forum');

create type public.execution_mode as enum ('single', 'seeding_2_accounts');

-- `running` is required: a queued task must be claimable by exactly one worker
-- before the browser automation starts, otherwise two workers double-post.
create type public.task_status as enum (
  'pending_approval',
  'queued',
  'running',
  'completed',
  'failed',
  'rejected'
);

create type public.conversion_status as enum ('pending', 'settled', 'canceled');

-- Auto-Persona warming (Phân hệ 2): lifestyle posts on an account's own timeline
-- and cross-warming comments between accounts of the farm.
create type public.warming_kind as enum ('lifestyle_post', 'cross_warm');

create type public.warming_status as enum ('completed', 'failed');

-- -----------------------------------------------------------------------------
-- 1 & 2. Social accounts, personas, trust score, warming schedule
-- -----------------------------------------------------------------------------
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  platform public.social_platform not null default 'facebook',
  -- User-defined persona key ('decor', 'me_bim', 'tech', ...). Deliberately not
  -- an enum: personas are operator-authored.
  persona_type text not null check (length(trim(persona_type)) > 0),
  -- Profile id inside GPM-Login / Genlogin.
  browser_profile_id text,
  proxy_ip text,
  status public.account_status not null default 'active',
  trust_score int not null default 10 check (trust_score between 0 and 100),
  bio_link_url text,
  -- Warming schedule for the Auto-Profile Builder, e.g.
  -- [{"at":"09:30","kind":"lifestyle_post"},{"at":"20:00","kind":"cross_warm"}]
  persona_schedule jsonb not null default '[]'::jsonb
    check (jsonb_typeof(persona_schedule) = 'array'),
  warmup_enabled boolean not null default true,
  last_warmed_at timestamptz,
  -- Set when status = 'cooldown'; the worker only picks the account back up
  -- once now() > cooldown_until.
  cooldown_until timestamptz,
  notes text,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.social_accounts.trust_score is
  'Persona trust, 0-100. Incremented by the warming worker, reset on checkpoint.';

create unique index social_accounts_browser_profile_key
  on public.social_accounts (platform, browser_profile_id)
  where browser_profile_id is not null;

create index social_accounts_status_idx on public.social_accounts (status);
create index social_accounts_persona_idx on public.social_accounts (persona_type);

-- -----------------------------------------------------------------------------
-- 2. Warming log — one row per persona action the warming worker performed
--
-- This is the audit trail that makes "the farm is warming itself" checkable:
-- it drives the schedule gate (a slot is not repeated), the cross-warm targeting
-- (which account already commented on which post) and the trust increment.
-- -----------------------------------------------------------------------------
create table public.warming_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  kind public.warming_kind not null,
  status public.warming_status not null default 'completed',
  -- The text that was published (lifestyle post body, or the cross-warm comment).
  content text,
  -- Permalink of the lifestyle post, so another account can warm it later.
  post_url text,
  -- For cross_warm: whose post was answered, and where.
  target_account_id uuid references public.social_accounts (id) on delete set null,
  target_post_url text,
  error text,
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint warming_runs_content_check check (
    status = 'failed' or content is not null
  )
);

create index warming_runs_account_time_idx on public.warming_runs (account_id, executed_at desc);
create index warming_runs_kind_idx on public.warming_runs (kind, executed_at desc);
create index warming_runs_target_post_idx on public.warming_runs (target_post_url);

-- -----------------------------------------------------------------------------
-- 2b. Worker heartbeats — the only way to notice a worker that died silently
--
-- The worker POSTs here on a timer (independent of the claim loop, so a long task
-- does not look like a dead process). /api/cron/health turns a stale heartbeat
-- into a Telegram alert, throttled through `alerted_at`.
-- -----------------------------------------------------------------------------
create table public.worker_heartbeats (
  worker text primary key check (length(trim(worker)) > 0),
  last_seen_at timestamptz not null default now(),
  host text,
  mode text,
  alerted_at timestamptz
);

-- -----------------------------------------------------------------------------
-- 3. Radar watchlist — groups / fanpages / KOLs / forums
-- -----------------------------------------------------------------------------
create table public.target_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  url text not null check (url ~* '^https?://'),
  source_type public.source_type not null,
  niche text,
  -- Fed to the Gemini prompt so drafts imitate the room instead of sounding
  -- like an ad.
  tone_of_voice text,
  group_rules text,
  scan_interval_mins int not null default 15 check (scan_interval_mins between 1 and 1440),
  is_active boolean not null default true,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (url)
);

create index target_sources_active_scan_idx
  on public.target_sources (is_active, last_scanned_at nulls first);

-- -----------------------------------------------------------------------------
-- 4. Products & affiliate pool
-- -----------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  shopee_item_id text unique,
  name text not null check (length(trim(name)) > 0),
  price numeric(14, 2) check (price is null or price >= 0),
  -- 15.5 means 15.5%.
  commission_rate numeric(5, 2) check (
    commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)
  ),
  affiliate_short_link text not null check (length(trim(affiliate_short_link)) > 0),
  -- Array of real buyer review image URLs, used as comment attachments.
  review_images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(review_images) = 'array'),
  pros_cons_summary text,
  niche text,
  -- 768 dims: Gemini text-embedding-004. Change here + lib/ai/embeddings.ts
  -- together if the embedding provider changes.
  embedding extensions.vector(768),
  is_active boolean not null default true check (is_active in (true, false)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_embedding_hnsw_idx
  on public.products using hnsw (embedding extensions.vector_cosine_ops);
create index products_niche_idx on public.products (niche);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 5 & 6. Radar output -> approval queue -> execution queue
-- -----------------------------------------------------------------------------
create table public.comment_tasks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.target_sources (id) on delete set null,
  -- Unique so a re-scan of the same post cannot produce a second draft.
  -- Normalisation (stripping tracking params) happens in the ingest API.
  post_url text not null check (post_url ~* '^https?://'),
  post_content text,
  post_images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(post_images) = 'array'),
  -- Gemini match probability, 0..1. Radar only enqueues >= RADAR_MATCH_THRESHOLD.
  match_score numeric(4, 3) check (match_score is null or match_score between 0 and 1),
  matched_product_id uuid references public.products (id) on delete set null,
  assigned_account_id uuid references public.social_accounts (id) on delete set null,
  -- Second account for execution_mode = 'seeding_2_accounts' (tier-2 reply).
  secondary_account_id uuid references public.social_accounts (id) on delete set null,
  ai_draft_comment text,
  selected_review_image text,
  execution_mode public.execution_mode not null default 'single',
  status public.task_status not null default 'pending_approval',
  -- Attribution token appended to the affiliate link and echoed back by the
  -- network postback into affiliate_conversions.sub_id.
  sub_id_code text unique,
  -- Operator feedback captured when a draft is rejected (used to tune prompts).
  review_note text,
  claimed_at timestamptz,
  -- Identity of the worker that claimed the task (prevents double execution).
  claimed_by text,
  -- What the worker observed but that is not a failure: e.g. the comment went out
  -- but the affiliate-link reply did not. Without this the operator only sees
  -- "completed" and never learns the link is missing.
  execution_note text,
  attempt_count int not null default 0 check (attempt_count >= 0),
  last_error text,
  executed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_url),
  constraint comment_tasks_seeding_needs_second_account check (
    execution_mode <> 'seeding_2_accounts' or secondary_account_id is not null
  ),
  -- A task cannot be "completed" without an execution timestamp: the conversion
  -- rate divides by executed tasks, and a completed-but-never-executed row lands
  -- in one term only (this exact gap produced a 200% conversion rate).
  constraint comment_tasks_completed_needs_executed_at check (
    status <> 'completed' or executed_at is not null
  )
);

create index comment_tasks_status_created_idx
  on public.comment_tasks (status, created_at desc);
-- The queue list orders by match score inside a status tab; without this the
-- planner sorts every row of the status before applying LIMIT.
create index comment_tasks_queue_order_idx
  on public.comment_tasks (status, match_score desc nulls last, created_at desc);
create index comment_tasks_source_idx on public.comment_tasks (source_id);
create index comment_tasks_account_idx on public.comment_tasks (assigned_account_id);

-- -----------------------------------------------------------------------------
-- 7. Conversions / ROI keyed by Sub_ID
-- -----------------------------------------------------------------------------
create table public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: the network postback may land before the join is resolvable.
  task_id uuid references public.comment_tasks (id) on delete set null,
  sub_id text not null,
  -- Network order id — makes postback ingestion idempotent.
  external_order_id text,
  order_amount numeric(14, 2) not null default 0 check (order_amount >= 0),
  estimated_commission numeric(14, 2) not null default 0 check (estimated_commission >= 0),
  status public.conversion_status not null default 'pending',
  converted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_order_id)
);

create index affiliate_conversions_sub_id_idx on public.affiliate_conversions (sub_id);
create index affiliate_conversions_task_idx on public.affiliate_conversions (task_id);
-- Every analytics window filters and groups by conversion time.
create index affiliate_conversions_converted_at_idx
  on public.affiliate_conversions (converted_at desc);

-- -----------------------------------------------------------------------------
-- Operator allowlist + RLS
-- Single-operator system: every table is readable/writable only by an
-- authenticated user present in public.operators. Workers use the service role,
-- which bypasses RLS by design.
-- -----------------------------------------------------------------------------
create table public.operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.operators o where o.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_operator() from public;
grant execute on function public.is_operator() to authenticated;

alter table public.social_accounts enable row level security;
alter table public.target_sources enable row level security;
alter table public.products enable row level security;
alter table public.comment_tasks enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.operators enable row level security;
alter table public.warming_runs enable row level security;
alter table public.worker_heartbeats enable row level security;

create policy "operators full access" on public.social_accounts
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators full access" on public.target_sources
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators full access" on public.products
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators full access" on public.comment_tasks
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators full access" on public.affiliate_conversions
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators full access" on public.warming_runs
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators full access" on public.worker_heartbeats
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- Operators may only read the allowlist (rows are inserted via SQL/service role).
create policy "operators can read allowlist" on public.operators
  for select to authenticated using (public.is_operator());

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- Empty search_path: the body resolves now() from pg_catalog and cannot be
-- hijacked by a schema earlier in a caller's path (Supabase advisor 0011).
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger social_accounts_set_updated_at before update on public.social_accounts
  for each row execute function public.set_updated_at();
create trigger target_sources_set_updated_at before update on public.target_sources
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger comment_tasks_set_updated_at before update on public.comment_tasks
  for each row execute function public.set_updated_at();
create trigger affiliate_conversions_set_updated_at before update on public.affiliate_conversions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Analytics views (module 7)
-- -----------------------------------------------------------------------------
create view public.v_account_performance
with (security_invoker = true) as
select
  a.id as account_id,
  a.name as account_name,
  a.persona_type,
  a.status,
  a.trust_score,
  -- count(distinct t.id): joining conversions fans a task out once per order, so a
  -- plain count() would report 3 "published" comments for a task with 3 orders.
  count(distinct t.id) filter (where t.status = 'completed') as comments_published,
  count(distinct t.id) filter (where t.status = 'failed') as comments_failed,
  coalesce(sum(c.order_amount) filter (where c.status <> 'canceled'), 0) as revenue,
  coalesce(sum(c.estimated_commission) filter (where c.status = 'settled'), 0) as settled_commission,
  max(t.executed_at) as last_executed_at
from public.social_accounts a
left join public.comment_tasks t on t.assigned_account_id = a.id
-- Same attribution predicate as v_task_roi, otherwise the leaderboard and the
-- ROI view disagree for postbacks that arrived before task_id was resolvable.
left join public.affiliate_conversions c
  on c.task_id = t.id
  or (c.task_id is null and c.sub_id = t.sub_id_code)
group by a.id;

-- Task-level attribution: joins the queue row to every conversion its Sub_ID
-- produced, including conversions whose postback arrived before the task link.
create view public.v_task_roi
with (security_invoker = true) as
select
  t.id as task_id,
  t.created_at,
  t.executed_at,
  t.status,
  t.execution_mode,
  t.sub_id_code,
  t.post_url,
  s.name as source_name,
  s.source_type,
  p.name as product_name,
  p.commission_rate,
  a.name as account_name,
  -- Canceled orders are not orders: excluding them here keeps this view
  -- consistent with the revenue/commission columns below and with the KPIs.
  count(c.id) filter (where c.status <> 'canceled') as orders,
  coalesce(sum(c.order_amount) filter (where c.status <> 'canceled'), 0) as revenue,
  coalesce(sum(c.estimated_commission) filter (where c.status <> 'canceled'), 0) as commission,
  coalesce(sum(c.estimated_commission) filter (where c.status = 'settled'), 0) as settled_commission
from public.comment_tasks t
left join public.target_sources s on s.id = t.source_id
left join public.products p on p.id = t.matched_product_id
left join public.social_accounts a on a.id = t.assigned_account_id
left join public.affiliate_conversions c
  on c.task_id = t.id
  or (c.task_id is null and c.sub_id = t.sub_id_code)
group by t.id, s.name, s.source_type, p.name, p.commission_rate, a.name;

-- -----------------------------------------------------------------------------
-- Aggregate stats (performance)
--
-- Each of these replaces a fan-out of round trips from the dashboard:
--   queue_counts   ← 6 separate count queries (one per status)
--   account_stats  ← 5 queries (4 counts + a full trust_score scan)
--   product_stats  ← "select *" of every product, aggregated in JS
-- One round trip each, computed where the data lives, and the payload is a
-- handful of numbers instead of whole tables.
-- -----------------------------------------------------------------------------
create or replace function public.queue_counts()
returns table (status public.task_status, total bigint)
language sql
stable
set search_path = ''
as $$
  select t.status, count(*) from public.comment_tasks t group by t.status;
$$;

create or replace function public.account_stats()
returns table (status public.account_status, total bigint, avg_trust numeric)
language sql
stable
set search_path = ''
as $$
  select a.status, count(*) as total, round(avg(a.trust_score)::numeric, 0) as avg_trust
    from public.social_accounts a
   group by a.status;
$$;

create or replace function public.product_stats()
returns table (total bigint, active bigint, avg_commission numeric, with_reviews bigint)
language sql
stable
set search_path = ''
as $$
  select
    count(*) as total,
    count(*) filter (where p.is_active) as active,
    round(avg(p.commission_rate)::numeric, 2) as avg_commission,
    count(*) filter (where jsonb_array_length(p.review_images) > 0) as with_reviews
  from public.products p;
$$;

revoke all on function public.queue_counts() from public, anon;
revoke all on function public.account_stats() from public, anon;
revoke all on function public.product_stats() from public, anon;
grant execute on function public.queue_counts() to authenticated;
grant execute on function public.account_stats() to authenticated;
grant execute on function public.product_stats() to authenticated;

-- -----------------------------------------------------------------------------
-- Worker RPC: atomically claim queued tasks for execution.
--
-- SKIP LOCKED is what stops two workers (or two retries of one worker) from
-- posting the same comment twice. Two more rules matter as much:
--   * only tasks whose accounts can actually post right now are handed out
--     (active status, cooldown elapsed, a browser profile to drive), and the
--     matched product must still exist — without it there is no affiliate link
--     and the comment would earn nothing;
--   * a worker that died mid-task leaves the row in `running`; the lease arm
--     reclaims it after 15 minutes, up to 3 attempts, so the queue self-heals.
--     15 minutes is WORKER_LEASE_MINUTES in src/lib/constants.ts — keep both in
--     step when changing the lease.
-- -----------------------------------------------------------------------------
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

-- On Supabase, objects created in `public` receive direct grants for anon and
-- authenticated through default privileges, so revoking from PUBLIC alone is not
-- enough — the browser-facing roles must be revoked explicitly. These functions
-- are SECURITY DEFINER and would otherwise let a holder of the anon key claim
-- the whole queue (and read the tasks back) or dump the product catalog.
revoke all on function public.claim_comment_tasks(text, int) from public, anon, authenticated;
grant execute on function public.claim_comment_tasks(text, int) to service_role;

-- -----------------------------------------------------------------------------
-- pgvector candidate retrieval: nearest active products to a post embedding.
-- Used by /api/worker/radar/ingest to shrink the candidate set before asking
-- Gemini to score it (semantic pre-filter, generative re-rank).
-- -----------------------------------------------------------------------------
create or replace function public.match_products(
  p_embedding extensions.vector(768),
  p_limit int default 25
)
returns table (
  id uuid,
  name text,
  niche text,
  pros_cons_summary text,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.niche,
    p.pros_cons_summary,
    1 - (p.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.products p
  where p.is_active
    and p.embedding is not null
  order by p.embedding operator(extensions.<=>) p_embedding
  limit greatest(least(p_limit, 50), 1);
$$;

revoke all on function public.match_products(extensions.vector, int) from public, anon, authenticated;
grant execute on function public.match_products(extensions.vector, int) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics aggregation (module 7)
--
-- These live in SQL because PostgREST caps every response at max_rows (1000) with
-- a 200 and no error: summing money in JS over an unbounded select silently
-- under-reports once a window holds more than 1000 conversions. Aggregating in
-- Postgres also removes the round-trip. All of them are SECURITY INVOKER, so RLS
-- still decides which rows the operator may aggregate.
--
-- Windows are conversion-time based (converted_at / executed_at), not task
-- creation: a postback that lands today belongs to today's revenue even when the
-- comment was written last month.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_summary(p_since timestamptz default null)
returns table (
  revenue numeric,
  commission numeric,
  settled_commission numeric,
  pending_commission numeric,
  canceled_commission numeric,
  orders bigint,
  tasks_executed bigint,
  tasks_with_orders bigint
)
language sql
stable
set search_path = ''
as $$
  with conv as (
    select c.status, c.order_amount, c.estimated_commission, c.task_id
      from public.affiliate_conversions c
     where p_since is null or c.converted_at >= p_since
  ),
  /*
   * "Executed" means the worker actually ran it: a task marked completed without
   * executed_at is a data gap (or legacy import), and counting it in only one of
   * the two conversion-rate terms produced rates above 100%.
   */
  executed as (
    select t.id
      from public.comment_tasks t
     where t.status = 'completed'
       and t.executed_at is not null
       and (p_since is null or t.executed_at >= p_since)
  )
  select
    (select coalesce(sum(order_amount), 0) from conv where status <> 'canceled'),
    (select coalesce(sum(estimated_commission), 0) from conv where status <> 'canceled'),
    (select coalesce(sum(estimated_commission), 0) from conv where status = 'settled'),
    (select coalesce(sum(estimated_commission), 0) from conv where status = 'pending'),
    (select coalesce(sum(estimated_commission), 0) from conv where status = 'canceled'),
    (select count(*) from conv where status <> 'canceled'),
    (select count(*) from executed),
    -- Numerator restricted to the same population as the denominator, so the
    -- ratio can never exceed 100%.
    (select count(distinct c.task_id)
       from conv c
       join executed e on e.id = c.task_id
      where c.status <> 'canceled');
$$;

create or replace function public.analytics_revenue_series(p_since timestamptz default null)
returns table (day date, revenue numeric, commission numeric, orders bigint)
language sql
stable
set search_path = ''
as $$
  with conv as (
    select (c.converted_at at time zone 'UTC')::date as day,
           c.order_amount,
           c.estimated_commission
      from public.affiliate_conversions c
     where c.status <> 'canceled'
       and (p_since is null or c.converted_at >= p_since)
  ),
  bounds as (
    select
      coalesce((p_since at time zone 'UTC')::date, min(day)) as start_day,
      -- Never plot past today, and never start on a day with no revenue.
      least(current_date, max(day)) as end_day
    from conv
  ),
  grid as (
    select generate_series(b.start_day, b.end_day, interval '1 day')::date as day
      from bounds b
     where b.start_day is not null
       and b.end_day is not null
       and b.start_day <= b.end_day
  )
  select g.day,
         coalesce(sum(c.order_amount), 0),
         coalesce(sum(c.estimated_commission), 0),
         count(c.day)
    from grid g
    left join conv c on c.day = g.day
   group by g.day
   order by g.day;
$$;

create or replace function public.analytics_by_source(p_since timestamptz default null)
returns table (label text, orders bigint, revenue numeric, commission numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(s.name, 'Unattributed') as label,
    count(c.id) filter (where c.status <> 'canceled') as orders,
    coalesce(sum(c.order_amount) filter (where c.status <> 'canceled'), 0) as revenue,
    coalesce(sum(c.estimated_commission) filter (where c.status <> 'canceled'), 0) as commission
  from public.affiliate_conversions c
  left join public.comment_tasks t
    on t.id = c.task_id
    or (c.task_id is null and t.sub_id_code = c.sub_id)
  left join public.target_sources s on s.id = t.source_id
  where p_since is null or c.converted_at >= p_since
  group by 1
  order by 4 desc;
$$;

create or replace function public.analytics_by_account(p_since timestamptz default null)
returns table (label text, orders bigint, revenue numeric, commission numeric)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(a.name, 'Unattributed') as label,
    count(c.id) filter (where c.status <> 'canceled') as orders,
    coalesce(sum(c.order_amount) filter (where c.status <> 'canceled'), 0) as revenue,
    coalesce(sum(c.estimated_commission) filter (where c.status <> 'canceled'), 0) as commission
  from public.affiliate_conversions c
  left join public.comment_tasks t
    on t.id = c.task_id
    or (c.task_id is null and t.sub_id_code = c.sub_id)
  left join public.social_accounts a on a.id = t.assigned_account_id
  where p_since is null or c.converted_at >= p_since
  group by 1
  order by 4 desc;
$$;

-- Task rows that produced at least one conversion inside the window (inner join
-- on purpose: a task with no orders in range is not attribution data).
create or replace function public.analytics_task_roi(
  p_since timestamptz default null,
  p_limit int default 100
)
returns table (
  task_id uuid,
  created_at timestamptz,
  executed_at timestamptz,
  status public.task_status,
  execution_mode public.execution_mode,
  sub_id_code text,
  post_url text,
  source_name text,
  source_type public.source_type,
  product_name text,
  commission_rate numeric,
  account_name text,
  orders bigint,
  revenue numeric,
  commission numeric,
  settled_commission numeric
)
language sql
stable
set search_path = ''
as $$
  select
    t.id,
    t.created_at,
    t.executed_at,
    t.status,
    t.execution_mode,
    t.sub_id_code,
    t.post_url,
    s.name,
    s.source_type,
    p.name,
    p.commission_rate,
    a.name,
    count(c.id) filter (where c.status <> 'canceled') as orders,
    coalesce(sum(c.order_amount) filter (where c.status <> 'canceled'), 0) as revenue,
    coalesce(sum(c.estimated_commission) filter (where c.status <> 'canceled'), 0) as commission,
    coalesce(sum(c.estimated_commission) filter (where c.status = 'settled'), 0) as settled_commission
  from public.comment_tasks t
  join public.affiliate_conversions c
    on c.task_id = t.id
    or (c.task_id is null and c.sub_id = t.sub_id_code)
  left join public.target_sources s on s.id = t.source_id
  left join public.products p on p.id = t.matched_product_id
  left join public.social_accounts a on a.id = t.assigned_account_id
  where p_since is null or c.converted_at >= p_since
  group by t.id, s.name, s.source_type, p.name, p.commission_rate, a.name
  order by coalesce(max(c.converted_at), t.created_at) desc
  limit greatest(least(p_limit, 500), 1);
$$;

revoke all on function public.analytics_summary(timestamptz) from public, anon;
revoke all on function public.analytics_revenue_series(timestamptz) from public, anon;
revoke all on function public.analytics_by_source(timestamptz) from public, anon;
revoke all on function public.analytics_by_account(timestamptz) from public, anon;
revoke all on function public.analytics_task_roi(timestamptz, int) from public, anon;

grant execute on function public.analytics_summary(timestamptz) to authenticated;
grant execute on function public.analytics_revenue_series(timestamptz) to authenticated;
grant execute on function public.analytics_by_source(timestamptz) to authenticated;
grant execute on function public.analytics_by_account(timestamptz) to authenticated;
grant execute on function public.analytics_task_roi(timestamptz, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: dashboard toasts + live queue refresh
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.comment_tasks;
    alter publication supabase_realtime add table public.affiliate_conversions;
  end if;
end
$$;
