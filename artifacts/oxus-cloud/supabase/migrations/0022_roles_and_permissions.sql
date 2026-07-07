-- =============================================================================
-- OXUS Cloud — roles (super_admin / pm), secure role management, client/contact
-- insert restrictions for PM users.
--
-- Bootstrap first super admin (run once in Supabase SQL editor after deploy):
--   update public.profiles
--   set role = 'super_admin'
--   where email = 'YOUR_EMAIL@example.com';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Migrate legacy role values
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
set role = 'super_admin'
where role = 'admin';

update public.profiles
set role = 'pm'
where role = 'member';

alter table public.profiles
  alter column role set default 'pm';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'pm'));

-- ---------------------------------------------------------------------------
-- Role helper functions
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  );
$$;

create or replace function public.is_pm_or_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('pm', 'super_admin')
  );
$$;

-- Keep is_team_member() for existing policies — any profile row is a team member.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid()
  );
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.is_pm_or_super_admin() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_pm_or_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Block direct role changes unless caller is super_admin (or service role).
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
      return new;
    end if;
    if not public.is_super_admin() then
      raise exception 'Only super admins can change user roles.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
  before update of role on public.profiles
  for each row
  execute function public.protect_profile_role();

-- ---------------------------------------------------------------------------
-- Secure role management RPC (super_admin only)
-- ---------------------------------------------------------------------------
create or replace function public.set_profile_role(target_user_id uuid, new_role text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
  super_admin_count integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can change user roles.';
  end if;

  if new_role not in ('super_admin', 'pm') then
    raise exception 'Invalid role: %', new_role;
  end if;

  if exists (
    select 1 from public.profiles
    where id = target_user_id and role = 'super_admin'
  ) and new_role = 'pm' then
    select count(*)::integer into super_admin_count
    from public.profiles
    where role = 'super_admin';

    if super_admin_count <= 1 then
      raise exception 'Cannot demote the last super admin.';
    end if;
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id
  returning * into result;

  if not found then
    raise exception 'Profile not found.';
  end if;

  return result;
end;
$$;

revoke all on function public.set_profile_role(uuid, text) from public;
grant execute on function public.set_profile_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- clients — PM can read; only super_admin can write
-- ---------------------------------------------------------------------------
drop policy if exists "clients_team_all" on public.clients;

drop policy if exists "clients_select_team" on public.clients;
create policy "clients_select_team"
  on public.clients for select
  to authenticated
  using (public.is_team_member());

drop policy if exists "clients_insert_super_admin" on public.clients;
create policy "clients_insert_super_admin"
  on public.clients for insert
  to authenticated
  with check (public.is_super_admin());

drop policy if exists "clients_update_super_admin" on public.clients;
create policy "clients_update_super_admin"
  on public.clients for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "clients_delete_super_admin" on public.clients;
create policy "clients_delete_super_admin"
  on public.clients for delete
  to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- contacts — PM can read; only super_admin can write
-- ---------------------------------------------------------------------------
drop policy if exists "contacts_team_all" on public.contacts;

drop policy if exists "contacts_select_team" on public.contacts;
create policy "contacts_select_team"
  on public.contacts for select
  to authenticated
  using (public.is_team_member());

drop policy if exists "contacts_insert_super_admin" on public.contacts;
create policy "contacts_insert_super_admin"
  on public.contacts for insert
  to authenticated
  with check (public.is_super_admin());

drop policy if exists "contacts_update_super_admin" on public.contacts;
create policy "contacts_update_super_admin"
  on public.contacts for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "contacts_delete_super_admin" on public.contacts;
create policy "contacts_delete_super_admin"
  on public.contacts for delete
  to authenticated
  using (public.is_super_admin());
