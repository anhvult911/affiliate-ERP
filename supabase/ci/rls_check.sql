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

-- A second tenant exists in the table but must never be visible to the Phase 1
-- operator. Phase 2 will swap public.lead_owner_id() for a real tenant lookup;
-- these assertions keep the owner filter honest until then.
insert into public.target_sources (user_id, name, url, source_type)
values ('tenant_b', 'Other tenant group', 'https://www.facebook.com/groups/other-tenant', 'group')
on conflict (user_id, url) do nothing;

insert into public.leads (user_id, post_id, group_name, post_url, post_content)
values ('tenant_b', 'tenant-b-post', 'Other tenant group',
        'https://www.facebook.com/groups/other-tenant/posts/1',
        'Nội dung đủ dài cho kiểm tra RLS đa chủ sở hữu.')
on conflict (user_id, post_id) do nothing;

select set_config('test.expected_leads',
  (select count(*)::text from public.leads where user_id = 'default_owner'), true);
select set_config('test.expected_sources',
  (select count(*)::text from public.target_sources where user_id = 'default_owner'), true);

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

  select count(*) into n from public.leads;
  if n <> 0 then
    raise exception 'RLS leak: non-operator read % leads', n;
  end if;

  select count(*) into n from public.target_sources;
  if n <> 0 then
    raise exception 'RLS leak: non-operator read % target_sources', n;
  end if;

  begin
    insert into public.leads (post_id, group_name, post_url, post_content)
    values ('forbidden-lead', 'Group', 'https://example.com/groups/forbidden/posts/1',
            'Nội dung không được ghi bởi người lạ.');
    raise exception 'RLS leak: non-operator inserted a lead';
  exception
    when insufficient_privilege then null;
  end;

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
  expected_leads int := current_setting('test.expected_leads')::int;
  expected_sources int := current_setting('test.expected_sources')::int;
begin
  select count(*) into n from public.comment_tasks;
  if n <> expected then
    raise exception 'operator saw % comment_tasks, expected all %', n, expected;
  end if;

  select count(*) into n from public.v_task_roi;
  if n <> expected_roi then
    raise exception 'operator saw % roi rows, expected all %', n, expected_roi;
  end if;

  -- Owner scope: the operator sees every default_owner lead/source and nothing
  -- belonging to another tenant.
  select count(*) into n from public.leads;
  if n <> expected_leads then
    raise exception 'operator saw % leads, expected own %', n, expected_leads;
  end if;

  select count(*) into n from public.target_sources;
  if n <> expected_sources then
    raise exception 'operator saw % target_sources, expected own %', n, expected_sources;
  end if;

  update public.leads set notes = 'cross-tenant write must not land' where user_id = 'tenant_b';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'RLS leak: operator updated % cross-tenant leads', n;
  end if;

  update public.target_sources set name = 'hijacked' where user_id = 'tenant_b';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'RLS leak: operator updated % cross-tenant target_sources', n;
  end if;

  begin
    insert into public.leads (user_id, post_id, group_name, post_url, post_content)
    values ('tenant_b', 'tenant-b-forbidden', 'Other tenant group',
            'https://www.facebook.com/groups/other-tenant/posts/2',
            'Không được tạo lead cho chủ sở hữu khác.');
    raise exception 'RLS leak: operator inserted a cross-tenant lead';
  exception
    when insufficient_privilege then null;
  end;

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
  raise notice 'RLS contract OK: non-operators read nothing and cannot write, operators read/write only their own leads and watchlist, worker RPCs stay service-role only';
end
$$;
