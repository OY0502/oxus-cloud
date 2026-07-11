-- Internal access control: restrict OXUS Cloud to @oxus.agency (+ explicit allowlist).

-- ---------------------------------------------------------------------------
-- Allowlist for grandfathered non-@oxus.agency accounts (e.g. owner email).
-- Managed via SQL / service role — not exposed for public writes.
-- ---------------------------------------------------------------------------
create table if not exists public.internal_auth_email_allowlist (
  email       text primary key,
  note        text,
  created_at  timestamptz not null default now()
);

alter table public.internal_auth_email_allowlist enable row level security;

drop policy if exists "internal_auth_allowlist_super_admin_select" on public.internal_auth_email_allowlist;
create policy "internal_auth_allowlist_super_admin_select"
  on public.internal_auth_email_allowlist
  for select
  to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Email normalization + internal-domain / allowlist checks.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_auth_email(email text)
returns text
language sql
immutable
as $$
  select lower(trim(email));
$$;

create or replace function public.is_internal_oxus_email(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when check_email is null or trim(check_email) = '' then false
      when split_part(public.normalize_auth_email(check_email), '@', 2) = 'oxus.agency' then true
      when exists (
        select 1
        from public.internal_auth_email_allowlist a
        where a.email = public.normalize_auth_email(check_email)
      ) then true
      else false
    end;
$$;

revoke all on function public.normalize_auth_email(text) from public;
revoke all on function public.is_internal_oxus_email(text) from public;
grant execute on function public.is_internal_oxus_email(text) to authenticated;

-- Grandfather existing non-@oxus.agency users so admins are not locked out.
insert into public.internal_auth_email_allowlist (email, note)
select distinct
  public.normalize_auth_email(p.email),
  'Grandfathered existing user at internal access migration'
from public.profiles p
where p.email is not null
  and split_part(public.normalize_auth_email(p.email), '@', 2) <> 'oxus.agency'
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Block profile creation for non-internal emails at signup.
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

  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Team membership requires a profile AND an allowed internal email.
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
      and public.is_internal_oxus_email(
        coalesce(p.email, auth.jwt() ->> 'email')
      )
  );
$$;

-- Prevent manual profile inserts for non-internal emails.
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles
  for insert
  to authenticated
  with check (
    id = auth.uid()
    and public.is_internal_oxus_email(coalesce(email, auth.jwt() ->> 'email'))
  );
