-- Sweep tasks whose lease expired and whose retries are exhausted.
--
-- docs/REVIEW.md P1-5: the lease is reclaimable only while `attempt_count < 3`. A
-- worker that dies between claim and report three times leaves the task in `running`
-- with `attempt_count = 3`, which no branch of the system can move again: claim skips
-- it, and the health cron only counted it into the backlog and then complained about
-- a stale worker. The row stayed "Đang chạy" forever and the operator had to remember
-- the 15-minute/3-attempt rule to fix it by hand.
--
-- This function is the automated exit. It only touches rows that are already beyond
-- any legitimate retry, so it can run as often as the cron likes.

create or replace function public.sweep_stuck_tasks(p_lease_minutes int default 15)
returns table (task_id uuid, account_id uuid, attempt_count int, post_url text)
language sql
security definer
set search_path = ''
as $$
  with stuck as (
    update public.comment_tasks t
       set status = 'failed',
           last_error = 'lease exhausted: worker stopped reporting after 3 attempts',
           review_note = coalesce(t.review_note, 'Tự động đóng: worker chết 3 lần, task kẹt ở running.')
     where t.status = 'running'
       and t.claimed_at is not null
       and t.claimed_at < now() - make_interval(mins => greatest(p_lease_minutes, 1))
       and t.attempt_count >= 3
    returning t.id, t.assigned_account_id, t.attempt_count, t.post_url
  )
  select s.id, s.assigned_account_id, s.attempt_count, s.post_url from stuck s;
$$;

revoke all on function public.sweep_stuck_tasks(int) from public, anon, authenticated;
grant execute on function public.sweep_stuck_tasks(int) to service_role;

comment on function public.sweep_stuck_tasks(int) is
  'Fails running tasks whose lease expired and whose 3 attempts are spent (docs/REVIEW.md P1-5).';
