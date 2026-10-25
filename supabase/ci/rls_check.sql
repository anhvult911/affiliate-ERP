-- =============================================================================
-- RLS contract check (bare Postgres / CI only — needs supabase/ci/supabase_shim.sql).
--
-- Run after the shim, the migrations and the seed:
--   docker exec affiliate-erp-pg psql -U postgres -v ON_ERROR_STOP=1 \
--     -f /tmp/shim.sql -f /tmp/init.sql -f /tmp/seed.sql -f /tmp/rls_check.sql
--
-- Fails loudly (exception -> non-zero psql exit) if an authenticated user who is
-- NOT in public.operators can read or write any domain table.
-- =============================================================================

begin;

insert into auth.users (id, email)
values
  ('99999999-9999-4999-8999-999999999999', 'operator@example.com'),
  ('88888888-8888-4888-8888-888888888888', 'intruder@example.com')
on conflict (id) do nothing;

insert into public.operators (user_id, email)
values ('99999999-9999-4999-8999-999999999999', 'operator@example.com')
on conflict (user_id) do nothing;

-- Ground truth, captured as the superuser (RLS bypassed) so the operator
-- assertions below hold on a seeded database *and* on one that has been used.
select set_config('test.expected_tasks', (select count(*)::text from public.comment_tasks), true);
select set_config('test.expected_roi', (select count(*)::text from public.v_task_roi), true);

-- --- non-operator: sees nothing, cannot write -------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

do $$
declare
  n int;
begin
  select count(*) into n from public.comment_tasks;
  if n <> 0 then
    raise exception 'RLS leak: non-operator read % comment_tasks', n;
  end if;

  select count(*) into n from public.social_accounts;
  if n <> 0 then
    raise exception 'RLS leak: non-operator read % social_accounts', n;
  end if;

  select count(*) into n from public.products;
  if n <> 0 then
    raise exception 'RLS leak: non-operator read % products', n;
  end if;

  begin
    insert into public.comment_tasks (post_url, status)
    values ('https://example.com/forbidden', 'pending_approval');
    raise exception 'RLS leak: non-operator inserted a comment_task';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- --- operator: full access --------------------------------------------------
set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

do $$
declare
  n int;
  expected int := current_setting('test.expected_tasks')::int;
  expected_roi int := current_setting('test.expected_roi')::int;
begin
  select count(*) into n from public.comment_tasks;
  if n <> expected then
    raise exception 'operator saw % comment_tasks, expected all %', n, expected;
  end if;

  select count(*) into n from public.v_task_roi;
  if n <> expected_roi then
    raise exception 'operator saw % roi rows, expected all %', n, expected_roi;
  end if;

  update public.comment_tasks
     set assigned_account_id = '11111111-1111-4111-8111-111111111111'
   where id = 'cccc1111-1111-4111-8111-111111111111'
     and assigned_account_id is null;
end
$$;

rollback;

-- --- worker RPCs are not reachable by browser roles -------------------------
-- Validated outside the transaction above because role switching interacts with
-- the RLS assertions. On Supabase, default privileges grant EXECUTE on new
-- public functions to anon/authenticated, so these must be explicitly revoked.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.claim_comment_tasks(text,int)', 'execute') then
      raise exception 'privilege leak: % can execute claim_comment_tasks', r;
    end if;

    if has_function_privilege(r, 'public.match_products(extensions.vector,int)', 'execute') then
      raise exception 'privilege leak: % can execute match_products', r;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.is_operator()', 'execute') then
    raise exception 'authenticated lost execute on is_operator() — RLS cannot work';
  end if;

  if not has_function_privilege('service_role', 'public.claim_comment_tasks(text,int)', 'execute') then
    raise exception 'service_role cannot execute claim_comment_tasks — the worker is broken';
  end if;
end
$$;

do $$
begin
  raise notice 'RLS contract OK: non-operators read nothing and cannot write, operators read and write, worker RPCs stay service-role only';
end
$$;
