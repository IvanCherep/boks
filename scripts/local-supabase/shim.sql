-- Minimal Supabase-compatible shim so boks migrations can run on plain Postgres.
create schema if not exists extensions;
create schema if not exists auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
grant select on auth.users to authenticated, service_role;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(auth.jwt() ->> 'role', ''), 'anon');
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;
