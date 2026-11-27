-- Zinny — tenant isolation (PRD page 9: "No user can see another university's data").
--
-- The app connects as `zinny_app`, which is NOT the table owner, so these policies
-- always apply to it. Every request runs inside a transaction that sets:
--   app.university_id  — the university being worked in
--   app.user_id        — the signed-in person
-- If either is missing, the app sees nothing.
--
-- This file lists no tables. It finds them:
--   * every table in `public` with a `university_id` column gets row-level security and
--     the `tenant_isolation` policy, and the app role may select/insert/update/delete it
--     (append-only for `audit_log` and `domain_events`);
--   * every other table is revoked from the app role, except `users` and `universities`,
--     which keep the special policies below.
-- Row-level security is enabled on every table in `public`. Tables without a policy are
-- deny-all for every role except the owner. Where the owner connection (`systemDb()`) is a
-- superuser or has BYPASSRLS, row-level security is also FORCED, so even a table-owner
-- connection is bound unless it bypasses on purpose. Where the owner can't bypass (some
-- managed hosts don't let the owner grant itself BYPASSRLS), it is enabled but not forced:
-- the owner stays exempt as the tables' owner, exactly as before, and every other role is
-- still bound. Either way deploys never stop on this.
-- No role other than the owner and the app role keeps any privilege on `public` objects:
-- grants to PUBLIC or to roles a hosting provider adds (Supabase's `anon` and
-- `authenticated`, which its REST API uses) are revoked on every run. A reporting role
-- has to be granted here, on purpose.
-- So a module's new table is protected the moment it exists. Re-runnable: applied by
-- `npm run db:push`, `npm run db:migrate` and the test setup.

create or replace function zinny_current_university() returns uuid
  language sql stable as $$ select nullif(current_setting('app.university_id', true), '')::uuid $$;

create or replace function zinny_current_user() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zinny_app') then
    raise exception 'The role zinny_app does not exist. Run `npm run agent:setup` or create it: CREATE ROLE zinny_app LOGIN PASSWORD ''...'';';
  end if;
  -- The app role must always be bound by row-level security.
  if exists (select 1 from pg_roles where rolname = 'zinny_app' and (rolsuper or rolbypassrls)) then
    raise exception 'zinny_app is a superuser or has BYPASSRLS, so row-level security would not separate institutes. Run: ALTER ROLE zinny_app NOSUPERUSER NOBYPASSRLS;';
  end if;
  if pg_has_role('zinny_app', current_user, 'member') then
    raise exception 'zinny_app is a member of the owner role %, so it could turn row-level security off. Revoke that membership.', current_user;
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relowner = (select oid from pg_roles where rolname = 'zinny_app')
  ) then
    raise exception 'zinny_app owns tables in public, so it could turn row-level security off. Make the owner role own them: ALTER TABLE ... OWNER TO %;', current_user;
  end if;
  -- Force row-level security only when the owner connection can still bypass it on purpose.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise notice 'The owner role % has neither SUPERUSER nor BYPASSRLS, so row-level security is enabled but not forced (the owner stays exempt as table owner; every other role is bound). To force it as well, run as a superuser: ALTER ROLE % BYPASSRLS;', current_user, current_user;
  end if;
end $$;

-- True when the owner connection bypasses row-level security, so forcing it is safe.
create or replace function pg_temp.zinny_can_force() returns boolean language sql as
  $f$ select exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) $f$;

-- Only the owner and the app role get anything in `public`: take back every other grant,
-- including PUBLIC's and those a hosting provider's default privileges add.
do $$
declare
  r record;
  app oid := (select oid from pg_roles where rolname = 'zinny_app');
begin
  for r in
    select c.relname, c.relkind, a.grantee
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and a.grantee <> c.relowner and a.grantee <> app
    group by c.relname, c.relkind, a.grantee
  loop
    execute format(
      'revoke all on %s %I from %s',
      case when r.relkind = 'S' then 'sequence' else 'table' end,
      r.relname,
      case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end
    );
  end loop;

  for r in
    select p.oid::regprocedure::text as fn, a.grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and a.grantee <> p.proowner and a.grantee <> app
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    group by p.oid, a.grantee
  loop
    execute format(
      'revoke all on function %s from %s',
      r.fn,
      case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end
    );
  end loop;
end $$;

grant usage on schema public to zinny_app;

-- Nothing is granted to the app role by default; this file decides every grant.
alter default privileges in schema public revoke all on tables from zinny_app;
alter default privileges in schema public revoke all on sequences from zinny_app;
alter default privileges in schema public revoke all on functions from zinny_app;
alter default privileges revoke execute on functions from public;

do $$
declare
  t text;
  append_only constant text[] := array['audit_log', 'domain_events'];
begin
  -- Tables holding university data: same policy everywhere.
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'university_id' and not a.attisdropped
      )
      and c.relname <> 'universities'
  loop
    execute format('alter table %I enable row level security', t);
    if pg_temp.zinny_can_force() then execute format('alter table %I force row level security', t); end if;
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (university_id = zinny_current_university()) with check (university_id = zinny_current_university())',
      t
    );
    execute format('revoke all on %I from zinny_app', t);
    if t = any(append_only) then
      execute format('grant select, insert on %I to zinny_app', t);
    else
      execute format('grant select, insert, update, delete on %I to zinny_app', t);
    end if;
  end loop;

  -- Tables without university_id are for the system connection only. Row-level security
  -- with no policy makes them deny-all for any role that isn't the owner.
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'university_id' and not a.attisdropped
      )
      and c.relname not in ('users', 'universities')
  loop
    execute format('revoke all on %I from zinny_app', t);
  end loop;
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname not in ('users', 'universities')
  loop
    execute format('alter table %I enable row level security', t);
    if pg_temp.zinny_can_force() then execute format('alter table %I force row level security', t); end if;
  end loop;
end $$;

-- A university can read only its own row. The app changes one column itself (whether the
-- institute charges GST); everything else goes through the core API on the owner connection.
alter table universities enable row level security;
do $$ begin if pg_temp.zinny_can_force() then alter table universities force row level security; end if; end $$;
drop policy if exists own_university on universities;
create policy own_university on universities
  using (id = zinny_current_university())
  with check (id = zinny_current_university());
revoke all on universities from zinny_app;
grant select on universities to zinny_app;
grant update (gst_enabled) on universities to zinny_app;

-- People are shared identities. Inside a university you can see yourself and anyone
-- who holds a role in that university — nobody else. The app may change only a person's
-- name, email, phone and password hash (profile, invites, erasure), never their id.
alter table users enable row level security;
do $$ begin if pg_temp.zinny_can_force() then alter table users force row level security; end if; end $$;
drop policy if exists visible_users on users;
create policy visible_users on users
  using (
    id = zinny_current_user()
    or exists (
      select 1 from role_assignments ra
      where ra.user_id = users.id and ra.university_id = zinny_current_university()
    )
  );
revoke all on users from zinny_app;
grant select on users to zinny_app;
grant update (name, email, phone, password_hash) on users to zinny_app;

-- Creating people happens through this function, because the new person is not yet
-- visible to the app. It never overwrites someone who already exists.
create or replace function zinny_upsert_user(p_email text, p_name text, p_phone text)
  returns uuid
  language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  insert into users (email, name, phone) values (lower(trim(p_email)), trim(p_name), nullif(trim(p_phone), ''))
  on conflict ((lower(email))) do nothing
  returning id into uid;
  if uid is null then
    select id into uid from users where lower(email) = lower(trim(p_email));
  end if;
  return uid;
end $$;

revoke execute on function zinny_upsert_user(text, text, text) from public;
grant execute on function zinny_upsert_user(text, text, text) to zinny_app;
grant execute on function zinny_current_university(), zinny_current_user() to zinny_app;
