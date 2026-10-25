-- =============================================================================
-- CI / local schema-validation shim — DO NOT apply to a Supabase project.
--
-- Supabase ships the `auth` schema, the `authenticated`/`anon`/`service_role`
-- roles and the `supabase_realtime` publication. A bare Postgres instance
-- (used to type-check migrations in CI) does not. This file creates the minimum
-- surface the migrations depend on, so `psql -f` over the migration proves every
-- statement parses and every constraint/index is accepted by a real planner.
--
--   docker run -d --name affiliate-erp-pg -p 55432:5432 \
--     -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
--   docker exec affiliate-erp-pg psql -U postgres -v ON_ERROR_STOP=1 \
--     -f /tmp/supabase_shim.sql -f /tmp/20261020090000_init_schema.sql
-- =============================================================================

create schema if not exists auth;
create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Mirrors Supabase's default privileges on the public schema: RLS policies only
-- decide *which rows*, these grants decide whether the role may touch the table.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

-- Functions too. Supabase grants EXECUTE on new public functions to the browser
-- roles, which is exactly why `revoke ... from public` is not sufficient for the
-- SECURITY DEFINER worker RPCs — rls_check.sql asserts they are revoked.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Minimal stand-in for GoTrue's users table (only the FK target matters here).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- `auth.uid()` reads the JWT subject that Supabase's PostgREST sets per request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
