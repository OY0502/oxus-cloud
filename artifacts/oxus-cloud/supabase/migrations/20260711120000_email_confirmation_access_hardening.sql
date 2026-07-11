-- Email confirmation, profile access status, and RLS hardening for dashboard/admin data.

-- ---------------------------------------------------------------------------
-- Profile access status (active / pending / blocked)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists access_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_access_status_check;

alter table public.profiles
  add constraint profiles_access_status_check
  check (access_status in ('active', 'pending', 'blocked'));

-- Existing users: active when email is confirmed, pending otherwise.
update public.profiles p
set access_status = case
  when exists (
    select 1
    from auth.users u
    where u.id = p.id
      and u.email_confirmed_at is not null
  ) then 'active'
  else 'pending'
end;

-- ---------------------------------------------------------------------------
-- Auth helpers: confirmed email + active profile
-- ---------------------------------------------------------------------------
create or replace function public.is_auth_email_confirmed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select u.email_confirmed_at is not null
      from auth.users u
      where u.id = auth.uid()
    ),
    false
  );
$$;

create or replace function public.is_profile_access_active()
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
      and p.access_status = 'active'
  );
$$;

revoke all on function public.is_auth_email_confirmed() from public;
revoke all on function public.is_profile_access_active() from public;
grant execute on function public.is_auth_email_confirmed() to authenticated;
grant execute on function public.is_profile_access_active() to authenticated;

-- Team membership: profile + internal email + confirmed email + active access.
create or replace function public.is_team_member()
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
      and p.access_status = 'active'
      and public.is_internal_oxus_email(
        coalesce(p.email, auth.jwt() ->> 'email')
      )
  )
  and public.is_auth_email_confirmed();
$$;

-- ---------------------------------------------------------------------------
-- Signup: pending until email confirmed; activate on confirmation.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_internal_oxus_email(new.email) then
    raise exception 'OXUS Cloud is an internal tool. Please use your @oxus.agency email.'
      using errcode = 'P0001';
  end if;

  insert into public.profiles (id, full_name, email, avatar_url, access_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    case when new.email_confirmed_at is not null then 'active' else 'pending' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

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
      and access_status in ('pending', 'blocked');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row
  execute function public.handle_user_email_confirmed();

-- ---------------------------------------------------------------------------
-- Dashboard / admin-only tables: super_admin read/write only.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  admin_tables text[] := array[
    'quotes',
    'invoices',
    'invoice_line_items',
    'transactions',
    'activities',
    'technologies'
  ];
begin
  foreach t in array admin_tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    execute format('drop policy if exists "%1$s_team_all" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s_select_super_admin" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s_insert_super_admin" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s_update_super_admin" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s_delete_super_admin" on public.%1$s;', t);

    execute format(
      'create policy "%1$s_select_super_admin" on public.%1$s
         for select to authenticated
         using (public.is_super_admin() and public.is_team_member());',
      t
    );
    execute format(
      'create policy "%1$s_insert_super_admin" on public.%1$s
         for insert to authenticated
         with check (public.is_super_admin() and public.is_team_member());',
      t
    );
    execute format(
      'create policy "%1$s_update_super_admin" on public.%1$s
         for update to authenticated
         using (public.is_super_admin() and public.is_team_member())
         with check (public.is_super_admin() and public.is_team_member());',
      t
    );
    execute format(
      'create policy "%1$s_delete_super_admin" on public.%1$s
         for delete to authenticated
         using (public.is_super_admin() and public.is_team_member());',
      t
    );
  end loop;
end;
$$;
