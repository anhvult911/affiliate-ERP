-- Single-flight lock for the Shopee pull jobs.
--
-- docs/TASKS.md T-SHOPEE-13. Two cron invocations overlapping (a slow page, a retry,
-- a manual run) would page through the same window twice and race on the watermark.
-- A lease column on affiliate_sync_state is enough: the acquisition is one atomic
-- UPDATE, so exactly one caller wins, and the lease expires on its own if the process
-- dies without releasing.
--
-- Advisory locks were rejected: PostgREST may serve consecutive requests on different
-- connections, so a session-scoped lock can be released by a different request.
--
-- Rollback: drop the two functions, then the two columns.

alter table public.affiliate_sync_state
  add column if not exists locked_until timestamptz,
  add column if not exists locked_by text;

create or replace function public.acquire_sync_lock(
  p_kind text,
  p_owner text,
  p_ttl_seconds int default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  acquired boolean;
begin
  -- The row may not exist on the very first run.
  insert into public.affiliate_sync_state (kind)
  values (p_kind)
  on conflict (kind) do nothing;

  update public.affiliate_sync_state s
     set locked_until = now() + make_interval(secs => greatest(p_ttl_seconds, 30)),
         locked_by = p_owner,
         updated_at = now()
   where s.kind = p_kind
     and (s.locked_until is null or s.locked_until <= now())
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_sync_lock(p_kind text, p_owner text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.affiliate_sync_state
     set locked_until = null,
         locked_by = null,
         updated_at = now()
   where kind = p_kind
     and locked_by = p_owner;
$$;

revoke all on function public.acquire_sync_lock(text, text, int) from public, anon, authenticated;
revoke all on function public.release_sync_lock(text, text) from public, anon, authenticated;
grant execute on function public.acquire_sync_lock(text, text, int) to service_role;
grant execute on function public.release_sync_lock(text, text) to service_role;

comment on function public.acquire_sync_lock(text, text, int) is
  'Lease-based single-flight for the Shopee jobs; expires so a dead run cannot block forever.';
