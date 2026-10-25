-- Reconcile conversions that arrived before the task they belong to had a Sub_ID.
--
-- The postback endpoint attributes an order by looking up `comment_tasks.sub_id_code`
-- at the moment it arrives. When the order lands first — a customer clicks an old
-- link before the operator regenerates a code, or the network reports late — the row
-- is stored with `task_id = null`. The analytics views already fall back to joining
-- on `sub_id`, but the row itself stays unattributed, so the postback's own
-- "attributed" flag stays false forever.
--
-- plpgsql on purpose: a data-modifying CTE is not visible to the other subqueries of
-- the same statement, so a pure-SQL version reported a stale `remaining` count while
-- claiming it had attributed a row.

create or replace function public.reconcile_conversions()
returns table (attributed int, remaining int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_count int;
  still_orphaned int;
begin
  with matched as (
    update public.affiliate_conversions c
       set task_id = t.id
      from public.comment_tasks t
     where c.task_id is null
       and t.sub_id_code = c.sub_id
    returning 1
  )
  select count(*)::int into matched_count from matched;

  select count(*)::int into still_orphaned
    from public.affiliate_conversions c
   where c.task_id is null;

  return query select matched_count, still_orphaned;
end;
$$;

revoke all on function public.reconcile_conversions() from public, anon, authenticated;
grant execute on function public.reconcile_conversions() to service_role;

comment on function public.reconcile_conversions() is
  'Attributes conversions whose sub_id now exists on a task. Safe to run repeatedly.';
