-- =============================================================================
-- Affiliate manual attribution (draft-only mode)
--
-- The queue can run in draft-only mode (`AFFILIATE_COMMENT_MODE` set to anything
-- other than `publish`): approval and the browser worker are disabled, but the
-- operator still needs to publish a comment by hand and keep commission attribution
-- intact.
--
-- Three rules shape this migration:
--   1. A manual publication is its own terminal state (`manually_published`).
--      It is NOT `completed`: it does not fabricate an automated execution, and
--      analytics' "tasks executed" denominator keeps counting only automated work.
--      A pre-existing failed/dry-run `executed_at` is preserved for audit rather
--      than cleared or repurposed as the manual time.
--   2. The Sub_ID is minted before any link is copied and is stable forever.
--      `ensure_task_sub_id` locks the task row, so two tabs (or an approval racing
--      a manual copy) cannot create two tokens for the same post. The unique
--      constraint on `sub_id_code` is the final arbiter for cross-task clashes.
--   3. The operator supplies the real permalink and publication time. There is no
--      Facebook API call, no browser automation and no fabricated post here.
--
-- `manually_published` is deliberately never cast as the enum in this file's DDL:
-- Postgres cannot use a new enum value inside the transaction that adds it. The
-- trigger compares `status::text`, and every writer (server action / future RPC)
-- sets the value at runtime, after this migration commits.
--
-- Rollback: drop the attribution trigger/function, the partial index, the two new
-- constraints and the three columns; the extra enum value is harmless to leave in
-- place (Postgres cannot drop a single enum value).
-- =============================================================================

alter type public.task_status add value if not exists 'manually_published';

-- -----------------------------------------------------------------------------
-- Operator-supplied evidence. Paired: a URL without a time (or vice versa) is a
-- half-written record that cannot be audited, so both columns are set together.
-- -----------------------------------------------------------------------------
alter table public.comment_tasks
  add column if not exists manual_post_url text,
  add column if not exists manual_published_at timestamptz,
  -- Email or user id of the authenticated operator who recorded it. Kept as text
  -- because the allowlist row may be deleted later; the audit trail must survive.
  add column if not exists manual_published_by text;

alter table public.comment_tasks
  drop constraint if exists comment_tasks_manual_url_is_http,
  drop constraint if exists comment_tasks_manual_url_is_facebook,
  drop constraint if exists comment_tasks_manual_publication_paired;

alter table public.comment_tasks
  -- Evidence must point at the Facebook post the operator actually made. This page is
  -- Facebook-only; an arbitrary https URL is not audit evidence for this workflow.
  add constraint comment_tasks_manual_url_is_facebook check (
    manual_post_url is null
    or manual_post_url ~* '^https?://([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.me|fb\.watch)([/:?#]|$)'
  ),
  add constraint comment_tasks_manual_publication_paired check (
    (manual_post_url is null) = (manual_published_at is null)
  );

-- The queue detail and analytics views look manual rows up by status. The existing
-- (status, created_at) index already covers the status arm; this partial index keeps
-- the "manual work in this window" scan cheap without indexing every task again.
create index if not exists comment_tasks_manual_published_idx
  on public.comment_tasks (manual_published_at desc)
  where manual_published_at is not null;

-- -----------------------------------------------------------------------------
-- Stable, race-safe Sub_ID minting.
--
-- Both the approval flow and the manual "copy tracked link" button call this. It
-- returns the existing code when one is already present, so a retried click, a
-- second tab or a later manual publication always reuses the same attribution.
--
-- The row lock is the important part: without it two concurrent callers could both
-- see NULL and mint different codes, and the conversion report would follow whichever
-- write committed last.
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: the caller's session (operator cookie client or the
-- service-role Telegram client) already has the rights this function needs. RLS on
-- comment_tasks decides which rows exist for an operator, and service_role bypasses
-- RLS by design. A SECURITY DEFINER variant would need its own auth.role() check and
-- would break on bare-Postgres/PGlite harnesses where the `auth` schema is absent.
create or replace function public.ensure_task_sub_id(p_task_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_attempt int := 0;
begin
  select t.sub_id_code
    into v_code
    from public.comment_tasks t
   where t.id = p_task_id
     for update;

  if not found then
    raise exception 'Task % does not exist.', p_task_id using errcode = 'P0002';
  end if;

  -- Stable by contract: never overwrite an existing token. A conversion may already
  -- be on its way back from the network under this code.
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_attempt := v_attempt + 1;

    -- Same alphabet as the TypeScript fallback: no I/O/0/1 look-alikes, because a
    -- human may read this code back from a network report. Built from core functions
    -- only (gen_random_uuid/md5/random) so a SECURITY INVOKER call never needs a
    -- grant on the extensions schema or the pgcrypto functions.
    v_code := 'T-' || (
      select string_agg(
               substr(
                 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                 (
                   (strpos('0123456789abcdef', substr(md5(gen_random_uuid()::text), i, 1)) - 1) * 2
                   + case when random() < 0.5 then 0 else 1 end
                 ) + 1,
                 1
               ),
               ''
             )
        from generate_series(1, 6) as s(i)
    );

    begin
      update public.comment_tasks
         set sub_id_code = v_code
       where id = p_task_id;
      return v_code;
    exception when unique_violation then
      -- Another task already owns this code. Locked rows are held until commit, so
      -- this is a different row and a retry with fresh entropy is correct.
      if v_attempt >= 5 then
        raise exception 'Could not mint a unique Sub_ID after % attempts.', v_attempt;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.ensure_task_sub_id(uuid) from public, anon;
grant execute on function public.ensure_task_sub_id(uuid) to authenticated, service_role;

comment on function public.ensure_task_sub_id(uuid) is
  'Returns the task Sub_ID, minting it atomically under a row lock. Stable across approval, manual copy and retries.';

-- -----------------------------------------------------------------------------
-- Attribution invariants enforced where every writer passes, not only in the app.
--
-- 1. A Sub_ID is immutable once assigned: approval may re-send the same code, but an
--    UPDATE that changes it is refused. A conversion may already be travelling back
--    under the old code.
-- 2. Manual evidence (`manual_post_url` + `manual_published_at`) only exists on a
--    `manually_published` task. This also stops an arbitrary URL from being attached
--    to a queued/running/completed automated task as if it were post evidence.
-- 3. A manual task must carry both fields and cannot claim a future time. `executed_at`
--    is deliberately untouched: a failed or dry run keeps its real execution timestamp
--    for audit, while analytics only counts `completed + executed_at`.
--
-- Status is compared as text so this file does not cast the enum value added in the
-- same transaction (Postgres forbids using it before commit).
-- -----------------------------------------------------------------------------
create or replace function public.guard_comment_task_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sub_id_code is not null and new.sub_id_code is distinct from old.sub_id_code then
    raise exception 'Sub_ID is immutable once assigned.' using errcode = '23514';
  end if;

  if new.manual_post_url is not null and new.status::text <> 'manually_published' then
    raise exception 'Manual publication evidence requires the manually_published status.'
      using errcode = '23514';
  end if;

  -- Existing automated work cannot be relabelled as manual: a queued/running row may
  -- still be posted by the worker, and completed is evidence of an actual dispatch.
  if new.status::text = 'manually_published'
     and old.status::text not in ('pending_approval', 'failed', 'dry_run', 'manually_published') then
    raise exception 'Only an unapproved, failed or dry-run task may be recorded as manually published.'
      using errcode = '23514';
  end if;

  -- And a manual post can never re-enter the automated pipeline.
  if old.status::text = 'manually_published' and new.status::text <> 'manually_published' then
    raise exception 'A manually published task cannot be requeued or dispatched.'
      using errcode = '23514';
  end if;

  if new.status::text = 'manually_published' then
    if new.manual_post_url is null or new.manual_published_at is null then
      raise exception 'manually_published requires both manual_post_url and manual_published_at.'
        using errcode = '23514';
    end if;
    if new.manual_published_at > now() + interval '5 minutes' then
      raise exception 'manual_published_at cannot be in the future.' using errcode = '23514';
    end if;
    -- A rehearsal/failure timestamp belongs to the audit record. Recording manual
    -- publication adds evidence; it must neither erase what the worker actually did
    -- nor fabricate an automated execution timestamp where none existed.
    if new.executed_at is distinct from old.executed_at then
      raise exception 'Manual publication must preserve the existing executed_at.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists comment_tasks_guard_attribution on public.comment_tasks;
create trigger comment_tasks_guard_attribution
  before update on public.comment_tasks
  for each row execute function public.guard_comment_task_attribution();

comment on column public.comment_tasks.manual_post_url is
  'Operator-supplied permalink of the comment they published by hand. Null for automated work.';
comment on column public.comment_tasks.manual_published_at is
  'Operator-supplied publication time. Set together with manual_post_url; never derived from executed_at.';
