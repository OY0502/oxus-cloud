-- Super-admin workspace user lifecycle: deactivate, reactivate, and delete login accounts.

-- Do not auto-reactivate admin-deactivated accounts on email confirmation.
create or replace function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
    and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    update public.profiles
    set access_status = 'active'
    where id = new.id
      and access_status = 'pending';
  end if;
  return new;
end;
$$;

-- Block direct access_status changes unless caller is super_admin (or service role).
create or replace function public.protect_profile_access_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.access_status is distinct from old.access_status then
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
      return new;
    end if;
    if not public.is_super_admin() then
      raise exception 'Only super admins can change user access status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_access_status on public.profiles;
create trigger trg_protect_profile_access_status
  before update of access_status on public.profiles
  for each row
  execute function public.protect_profile_access_status();

create or replace function public.set_profile_access_status(target_user_id uuid, new_status text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
  active_super_admin_count integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can change user access status.';
  end if;

  if new_status not in ('active', 'blocked') then
    raise exception 'Invalid access status: %', new_status;
  end if;

  if target_user_id = auth.uid() then
    raise exception 'You cannot change your own account status.';
  end if;

  if new_status = 'blocked' and exists (
    select 1 from public.profiles
    where id = target_user_id and role = 'super_admin'
  ) then
    select count(*)::integer into active_super_admin_count
    from public.profiles
    where role = 'super_admin' and access_status = 'active';

    if active_super_admin_count <= 1 then
      raise exception 'Cannot deactivate the last active super admin.';
    end if;
  end if;

  update public.profiles
  set access_status = new_status
  where id = target_user_id
  returning * into result;

  if not found then
    raise exception 'Profile not found.';
  end if;

  return result;
end;
$$;

revoke all on function public.set_profile_access_status(uuid, text) from public;
grant execute on function public.set_profile_access_status(uuid, text) to authenticated;

create or replace function public.delete_workspace_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  active_super_admin_count integer;
  target_role text;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can delete workspace users.';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'You cannot delete your own account from here. Use account settings instead.';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;

  if target_role = 'super_admin' then
    select count(*)::integer into active_super_admin_count
    from public.profiles
    where role = 'super_admin' and access_status = 'active';

    if active_super_admin_count <= 1 then
      raise exception 'Cannot delete the last active super admin.';
    end if;
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

revoke all on function public.delete_workspace_user(uuid) from public;
grant execute on function public.delete_workspace_user(uuid) to authenticated;
