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

  -- Tables without university_id are for the system connection only.
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
end $$;

-- A university can read and edit only its own row.
alter table universities enable row level security;
drop policy if exists own_university on universities;
create policy own_university on universities
  using (id = zinny_current_university())
  with check (id = zinny_current_university());
revoke all on universities from zinny_app;
grant select, update on universities to zinny_app;

-- People are shared identities. Inside a university you can see yourself and anyone
-- who holds a role in that university — nobody else.
alter table users enable row level security;
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
grant select, update on users to zinny_app;

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
