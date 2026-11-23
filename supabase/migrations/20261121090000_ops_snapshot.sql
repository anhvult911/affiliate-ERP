-- The ops board needs counts and timestamps, not product vectors or individual tasks.
create or replace function public.ops_snapshot()
returns table (
  products_active bigint, products_missing_embedding bigint, product_last_created_at timestamptz,
  dealt_count_7d bigint, last_dealt_at timestamptz,
  targets_total bigint, targets_active bigint, last_scanned_at timestamptz,
  accounts_total bigint, accounts_active bigint, last_warmed_at timestamptz,
  pending_approval bigint, queued bigint, running bigint, task_last_created_at timestamptz,
  recent_captures bigint, best_recent_score numeric
)
language sql stable security invoker
set search_path = ''
as $$
  select p.*, s.*, a.*, t.*, r.*
  from (
    select count(*) filter (where is_active), count(*) filter (where embedding is null), max(created_at),
           count(*) filter (where last_dealt_at >= now() - interval '168 hours'),
           max(last_dealt_at) filter (where last_dealt_at >= now() - interval '168 hours')
    from public.products
  ) p
  cross join (
    select count(*), count(*) filter (where is_active), max(last_scanned_at) from public.target_sources
  ) s
  cross join (
    select count(*), count(*) filter (where status = 'active'), max(last_warmed_at) from public.social_accounts
  ) a
  cross join (
    select count(*) filter (where status = 'pending_approval'), count(*) filter (where status = 'queued'),
           count(*) filter (where status = 'running'), max(created_at) from public.comment_tasks
  ) t
  cross join (
    select count(*), max(recent.score) from (
      select score from public.radar_seen order by seen_at desc limit 200
    ) recent
  ) r;
$$;

revoke all on function public.ops_snapshot() from public, anon;
grant execute on function public.ops_snapshot() to authenticated;
