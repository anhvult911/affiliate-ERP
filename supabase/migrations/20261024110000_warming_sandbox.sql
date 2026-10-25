-- Runs executed against the local fixture must never look like real activity.
--
-- Before this, a `--executor=fixture` warming cycle marked the real account as
-- "profile built" and wrote a fixture bio into it, so the dashboard claimed work
-- that never touched Facebook. The flag keeps rehearsal rows in the audit trail
-- while excluding them from account state.

alter table public.warming_runs
  add column if not exists sandbox boolean not null default false;

comment on column public.warming_runs.sandbox is
  'True when the run used the local fixture instead of the real platform.';
