-- Team management: richer project assignments, secure rate changes, activity visibility.

-- ---------------------------------------------------------------------------
-- project_contact_assignees — allocation and lifecycle fields
-- ---------------------------------------------------------------------------
alter table public.project_contact_assignees
  add column if not exists role_on_project text,
  add column if not exists allocation_percent numeric(5,2),
  add column if not exists weekly_hours numeric(6,2),
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists is_active boolean not null default true,
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_project_contact_assignees_updated_at on public.project_contact_assignees;
create trigger trg_project_contact_assignees_updated_at
  before update on public.project_contact_assignees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities — restrict compensation-related entries to super admins
-- ---------------------------------------------------------------------------
alter table public.activities
  add column if not exists visibility text not null default 'team';

alter table public.activities drop constraint if exists activities_visibility_check;
alter table public.activities
  add constraint activities_visibility_check
  check (visibility in ('team', 'admin_only'));

drop policy if exists "activities_team_all" on public.activities;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated
  using (
    public.is_team_member()
    and (visibility = 'team' or public.is_super_admin())
  );

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated
  with check (public.is_team_member());

drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities
  for delete to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- change_team_member_rate — close current rate and open a new one atomically
-- ---------------------------------------------------------------------------
create or replace function public.change_team_member_rate(
  p_person_id uuid,
  p_rate_type text,
  p_amount numeric,
  p_currency text default 'EUR',
  p_effective_from date default current_date,
  p_notes text default null
)
returns public.team_member_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate public.team_member_rates;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can change compensation rates';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Rate amount must be positive';
  end if;

  update public.team_member_rates
  set effective_to = (p_effective_from - interval '1 day')::date
  where person_id = p_person_id
    and effective_to is null
    and effective_from <= p_effective_from;

  insert into public.team_member_rates (
    person_id, rate_type, amount, currency, effective_from, notes
  )
  values (
    p_person_id, p_rate_type, p_amount, coalesce(p_currency, 'EUR'), p_effective_from, p_notes
  )
  returning * into v_rate;

  update public.contacts
  set hourly_rate = case when p_rate_type = 'hourly' then p_amount else hourly_rate end,
      updated_at = now()
  where id = p_person_id;

  insert into public.activities (
    kind, title, description, entity_type, entity_id, contact_id, visibility, created_by
  )
  values (
    'info',
    'Rate changed',
    format('New %s rate effective %s', p_rate_type, p_effective_from),
    'team_rate',
    v_rate.id,
    p_person_id,
    'admin_only',
    auth.uid()
  );

  return v_rate;
end;
$$;

revoke all on function public.change_team_member_rate(uuid, text, numeric, text, date, text) from public;
grant execute on function public.change_team_member_rate(uuid, text, numeric, text, date, text) to authenticated;
