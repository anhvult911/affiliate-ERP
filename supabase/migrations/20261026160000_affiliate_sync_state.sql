-- Persistent watermark for the Shopee pull jobs.
--
-- docs/SHOPEE_API.md §5.3 (T-SHOPEE-09). `conversionReport` paginates with a
-- `scrollId` that expires in 30 seconds — it cannot survive a cron run, let alone a
-- crash. The cursor therefore lives in memory for one run, while the durable progress
-- marker is a purchase-time watermark in this table. A run that dies mid-page resumes
-- from the last committed watermark; the overlap lookback (see the TS helper) covers
-- orders that Shopee reports late.
--
-- Rollback: drop the two functions, then the table. No other object references it.

create table if not exists public.affiliate_sync_state (
  id uuid primary key default gen_random_uuid(),
  kind text not null unique check (kind in ('conversion', 'validated', 'product')),
  /** Newest purchase time that has been fully ingested. */
  watermark timestamptz,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.affiliate_sync_state enable row level security;

drop policy if exists "operators read affiliate sync state" on public.affiliate_sync_state;
create policy "operators read affiliate sync state"
  on public.affiliate_sync_state for select to authenticated
  using (public.is_operator());

-- ---------------------------------------------------------------------------
-- Watermarks only move forward: a late-finishing run must never rewind progress and
-- cause the next run to re-ingest (and potentially overwrite) older orders.
-- ---------------------------------------------------------------------------
create or replace function public.advance_sync_watermark(p_kind text, p_watermark timestamptz)
returns table (kind text, watermark timestamptz, last_run_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
-- The OUT parameters are named after the columns they return, so bare `kind` inside
-- the INSERT would be ambiguous; resolve in favour of the column.
#variable_conflict use_column
begin
  insert into public.affiliate_sync_state (kind, watermark, last_run_at, last_error)
  values (p_kind, p_watermark, now(), null)
  on conflict (kind) do update
    set watermark = greatest(
          coalesce(public.affiliate_sync_state.watermark, p_watermark),
          p_watermark
        ),
        last_run_at = now(),
        last_error = null,
        updated_at = now();

  return query
    select s.kind, s.watermark, s.last_run_at
      from public.affiliate_sync_state s
     where s.kind = p_kind;
end;
$$;

-- A failed run records the reason but leaves the watermark untouched, so the next run
-- retries exactly the same window.
create or replace function public.record_sync_error(p_kind text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.affiliate_sync_state (kind, last_run_at, last_error)
  values (p_kind, now(), left(p_error, 2000))
  on conflict (kind) do update
    set last_run_at = now(),
        last_error = left(p_error, 2000),
        updated_at = now();
$$;

revoke all on function public.advance_sync_watermark(text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_sync_error(text, text) from public, anon, authenticated;
grant execute on function public.advance_sync_watermark(text, timestamptz) to service_role;
grant execute on function public.record_sync_error(text, text) to service_role;

comment on table public.affiliate_sync_state is
  'Durable pull watermark per job; scrollId cursors are per-run only (30s TTL).';
