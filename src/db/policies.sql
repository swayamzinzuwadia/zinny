-- Zinny — tenant isolation (PRD page 9: "No user can see another university's data").
--
-- The app connects as `zinny_app`, which is NOT the table owner, so these policies
-- always apply to it. Every request runs inside a transaction that sets:
--   app.university_id  — the university being worked in
--   app.user_id        — the signed-in person
-- If either is missing, the app sees nothing. Re-runnable: safe to apply on every deploy.

create or replace function zinny_current_university() returns uuid
  language sql stable as $$ select nullif(current_setting('app.university_id', true), '')::uuid $$;

create or replace function zinny_current_user() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Tables keyed by university_id: same policy everywhere.
do $$
declare t text;
begin
  foreach t in array array[
    'departments','programs','batches','courses','course_sections','lessons',
    'batch_slots','session_overrides','enrolments','batch_switch_requests',
    'parent_links','orders','invoice_counters','invoices','notifications',
    'role_assignments','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (university_id = zinny_current_university()) with check (university_id = zinny_current_university())',
      t
    );
  end loop;
end $$;

-- A university can read and edit only its own row.
alter table universities enable row level security;
drop policy if exists own_university on universities;
create policy own_university on universities
  using (id = zinny_current_university())
  with check (id = zinny_current_university());

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

-- Grants for the app role.
grant usage on schema public to zinny_app;
grant select, update on universities to zinny_app;
grant select, update on users to zinny_app;
grant select, insert, update, delete on
  departments, programs, batches, courses, course_sections, lessons, batch_slots,
  session_overrides, enrolments, batch_switch_requests, parent_links, orders,
  invoice_counters, invoices, notifications, role_assignments
to zinny_app;
grant select, insert on audit_log to zinny_app;          -- append-only
revoke all on sessions, support_sessions from zinny_app; -- system only
grant execute on function zinny_upsert_user(text, text, text) to zinny_app;
grant execute on function zinny_current_university(), zinny_current_user() to zinny_app;
