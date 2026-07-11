-- Team member rates: multi-scope, multi-currency, historical preservation.

-- ---------------------------------------------------------------------------
-- team_member_rates — extended fields
-- ---------------------------------------------------------------------------
alter table public.team_member_rates
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists work_type text,
  add column if not exists is_default boolean not null default false,
  add column if not exists status text not null default 'active';

alter table public.team_member_rates drop constraint if exists team_member_rates_currency_check;
alter table public.team_member_rates
  add constraint team_member_rates_currency_check
  check (upper(currency) in ('EUR', 'USD'));

alter table public.team_member_rates drop constraint if exists team_member_rates_status_check;
alter table public.team_member_rates
  add constraint team_member_rates_status_check
  check (status in ('active', 'scheduled', 'expired'));

create index if not exists idx_team_member_rates_person_active
  on public.team_member_rates (person_id, effective_from, effective_to);

create index if not exists idx_team_member_rates_project
  on public.team_member_rates (project_id) where project_id is not null;

create index if not exists idx_team_member_rates_work_type
  on public.team_member_rates (work_type) where work_type is not null;

-- Backfill existing rows
update public.team_member_rates
set
  name = coalesce(name, initcap(replace(rate_type, '_', ' ')) || ' rate'),
  is_default = coalesce(is_default, project_id is null and work_type is null),
  status = case
    when effective_from > current_date then 'scheduled'
    when effective_to is not null and effective_to < current_date then 'expired'
    else 'active'
  end
where name is null or status = 'active';

-- ---------------------------------------------------------------------------
-- project_contact_assignees — explicit rate reference
-- ---------------------------------------------------------------------------
alter table public.project_contact_assignees
  add column if not exists rate_id uuid references public.team_member_rates(id) on delete set null,
  add column if not exists rate_snapshot_amount numeric(14,2),
  add column if not exists rate_snapshot_currency text,
  add column if not exists rate_snapshot_at timestamptz;

-- ---------------------------------------------------------------------------
-- payouts — FX reporting + rate reference
-- ---------------------------------------------------------------------------
alter table public.payouts
  add column if not exists amount_eur numeric(14,2),
  add column if not exists fx_status text,
  add column if not exists fx_rate_to_eur numeric(18,8),
  add column if not exists fx_rate_date date,
  add column if not exists fx_source text,
  add column if not exists rate_id uuid references public.team_member_rates(id) on delete set null;

alter table public.payouts drop constraint if exists payouts_fx_status_check;
alter table public.payouts
  add constraint payouts_fx_status_check
  check (fx_status is null or fx_status in ('native_eur', 'converted', 'pending', 'failed', 'unavailable'));

-- ---------------------------------------------------------------------------
-- contractor_invoices — FX reporting
-- ---------------------------------------------------------------------------
alter table public.contractor_invoices
  add column if not exists total_eur numeric(14,2),
  add column if not exists fx_status text,
  add column if not exists fx_rate_to_eur numeric(18,8),
  add column if not exists fx_rate_date date,
  add column if not exists fx_source text;

alter table public.contractor_invoices drop constraint if exists contractor_invoices_fx_status_check;
alter table public.contractor_invoices
  add constraint contractor_invoices_fx_status_check
  check (fx_status is null or fx_status in ('native_eur', 'converted', 'pending', 'failed', 'unavailable'));

-- Backfill native EUR payouts/invoices
update public.payouts
set
  amount_eur = coalesce(amount_eur, amount),
  fx_status = coalesce(fx_status, 'native_eur'),
  fx_rate_to_eur = coalesce(fx_rate_to_eur, 1),
  fx_rate_date = coalesce(fx_rate_date, payment_date),
  fx_source = coalesce(fx_source, 'native')
where upper(currency) = 'EUR';

update public.contractor_invoices
set
  total_eur = coalesce(total_eur, total),
  fx_status = coalesce(fx_status, 'native_eur'),
  fx_rate_to_eur = coalesce(fx_rate_to_eur, 1),
  fx_rate_date = coalesce(fx_rate_date, invoice_date),
  fx_source = coalesce(fx_source, 'native')
where upper(currency) = 'EUR';

update public.payouts set fx_status = 'pending' where upper(currency) <> 'EUR' and amount_eur is null and fx_status is null;
update public.contractor_invoices set fx_status = 'pending' where upper(currency) <> 'EUR' and total_eur is null and fx_status is null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.team_member_rate_scope_key(
  p_project_id uuid,
  p_work_type text
)
returns text
language sql
immutable
as $$
  select coalesce(p_project_id::text, '') || '|' || coalesce(lower(trim(p_work_type)), '');
$$;

create or replace function public.compute_team_member_rate_status(
  p_effective_from date,
  p_effective_to date
)
returns text
language sql
immutable
as $$
  select case
    when p_effective_from > current_date then 'scheduled'
    when p_effective_to is not null and p_effective_to < current_date then 'expired'
    else 'active'
  end;
$$;

create or replace function public.rate_is_active_on_date(
  p_effective_from date,
  p_effective_to date,
  p_as_of date
)
returns boolean
language sql
immutable
as $$
  select p_effective_from <= p_as_of
    and (p_effective_to is null or p_effective_to >= p_as_of);
$$;

-- Check overlapping identical-scope rates
create or replace function public.validate_team_member_rate_overlap(
  p_id uuid,
  p_person_id uuid,
  p_project_id uuid,
  p_work_type text,
  p_is_default boolean,
  p_effective_from date,
  p_effective_to date
)
returns void
language plpgsql
as $$
declare
  v_conflict uuid;
begin
  if p_is_default then
    select id into v_conflict
    from public.team_member_rates
    where person_id = p_person_id
      and is_default = true
      and (p_id is null or id <> p_id)
      and public.rate_is_active_on_date(effective_from, effective_to, greatest(p_effective_from, current_date))
      and (
        p_effective_to is null
        or effective_from <= p_effective_to
      )
      and (
        effective_to is null
        or effective_to >= p_effective_from
      )
    limit 1;
    if v_conflict is not null then
      raise exception 'An active default rate already exists for this period';
    end if;
  end if;

  select id into v_conflict
  from public.team_member_rates
  where person_id = p_person_id
    and (p_id is null or id <> p_id)
    and public.team_member_rate_scope_key(project_id, work_type)
      = public.team_member_rate_scope_key(p_project_id, p_work_type)
    and public.rate_is_active_on_date(effective_from, effective_to, greatest(p_effective_from, current_date))
    and (
      p_effective_to is null
      or effective_from <= p_effective_to
    )
    and (
      effective_to is null
      or effective_to >= p_effective_from
    )
  limit 1;

  if v_conflict is not null then
    raise exception 'An overlapping rate with the same scope already exists for this period';
  end if;
end;
$$;

-- Rate usage check
create or replace function public.team_member_rate_is_used(p_rate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.payouts where rate_id = p_rate_id
    union all
    select 1 from public.project_contact_assignees where rate_id = p_rate_id
    union all
    select 1 from public.contractor_invoices where metadata->>'rate_id' = p_rate_id::text
  );
$$;

-- ---------------------------------------------------------------------------
-- Update change_team_member_rate — only closes default-scope rates (backwards compat)
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
  v_currency text;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can change compensation rates';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Rate amount must be positive';
  end if;

  v_currency := upper(coalesce(p_currency, 'EUR'));
  if v_currency not in ('EUR', 'USD') then
    raise exception 'Unsupported currency: %', v_currency;
  end if;

  -- Close only the current default rate (no project, no work type)
  update public.team_member_rates
  set
    effective_to = (p_effective_from - interval '1 day')::date,
    status = public.compute_team_member_rate_status(effective_from, (p_effective_from - interval '1 day')::date)
  where person_id = p_person_id
    and project_id is null
    and work_type is null
    and effective_to is null
    and effective_from <= p_effective_from;

  perform public.validate_team_member_rate_overlap(
    null, p_person_id, null, null, true, p_effective_from, null
  );

  insert into public.team_member_rates (
    person_id, rate_type, amount, currency, effective_from, notes,
    name, is_default, status
  )
  values (
    p_person_id, p_rate_type, p_amount, v_currency, p_effective_from, p_notes,
    'Default ' || initcap(replace(p_rate_type, '_', ' ')) || ' rate',
    true,
    public.compute_team_member_rate_status(p_effective_from, null)
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
    format('New default %s rate effective %s', p_rate_type, p_effective_from),
    'team_rate',
    v_rate.id,
    p_person_id,
    'admin_only',
    auth.uid()
  );

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_team_member_rate
-- ---------------------------------------------------------------------------
create or replace function public.create_team_member_rate(
  p_person_id uuid,
  p_name text,
  p_rate_type text,
  p_amount numeric,
  p_currency text default 'EUR',
  p_project_id uuid default null,
  p_work_type text default null,
  p_is_default boolean default false,
  p_effective_from date default current_date,
  p_effective_to date default null,
  p_description text default null,
  p_notes text default null
)
returns public.team_member_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate public.team_member_rates;
  v_currency text;
  v_is_default boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can manage compensation rates';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Rate amount must be positive';
  end if;

  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'End date cannot be before start date';
  end if;

  v_currency := upper(coalesce(p_currency, 'EUR'));
  if v_currency not in ('EUR', 'USD') then
    raise exception 'Unsupported currency: %', v_currency;
  end if;

  v_is_default := coalesce(p_is_default, false)
    or (p_project_id is null and (p_work_type is null or trim(p_work_type) = ''));

  if v_is_default and p_project_id is not null then
    v_is_default := false;
  end if;

  perform public.validate_team_member_rate_overlap(
    null, p_person_id, p_project_id, p_work_type, v_is_default, p_effective_from, p_effective_to
  );

  -- If setting as default, clear other default flags for active rates
  if v_is_default then
    update public.team_member_rates
    set is_default = false
    where person_id = p_person_id
      and is_default = true
      and effective_to is null;
  end if;

  insert into public.team_member_rates (
    person_id, name, description, rate_type, amount, currency,
    project_id, work_type, is_default,
    effective_from, effective_to, notes, status
  )
  values (
    p_person_id,
    coalesce(nullif(trim(p_name), ''), 'Rate'),
    p_description,
    p_rate_type,
    p_amount,
    v_currency,
    p_project_id,
    nullif(trim(p_work_type), ''),
    v_is_default,
    p_effective_from,
    p_effective_to,
    p_notes,
    public.compute_team_member_rate_status(p_effective_from, p_effective_to)
  )
  returning * into v_rate;

  if p_rate_type = 'hourly' and v_is_default then
    update public.contacts
    set hourly_rate = p_amount, updated_at = now()
    where id = p_person_id;
  end if;

  insert into public.activities (
    kind, title, description, entity_type, entity_id, contact_id, visibility, created_by
  )
  values (
    'info',
    'Rate created',
    format('%s effective %s', v_rate.name, p_effective_from),
    'team_rate',
    v_rate.id,
    p_person_id,
    'admin_only',
    auth.uid()
  );

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_team_member_rate — only for unused future rates
-- ---------------------------------------------------------------------------
create or replace function public.update_team_member_rate(
  p_rate_id uuid,
  p_name text default null,
  p_description text default null,
  p_rate_type text default null,
  p_amount numeric default null,
  p_currency text default null,
  p_project_id uuid default null,
  p_work_type text default null,
  p_is_default boolean default null,
  p_effective_from date default null,
  p_effective_to date default null,
  p_notes text default null,
  p_allow_used boolean default false
)
returns public.team_member_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.team_member_rates;
  v_rate public.team_member_rates;
  v_currency text;
  v_is_used boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can manage compensation rates';
  end if;

  select * into v_existing from public.team_member_rates where id = p_rate_id;
  if not found then
    raise exception 'Rate not found';
  end if;

  v_is_used := public.team_member_rate_is_used(p_rate_id);
  if v_is_used and not coalesce(p_allow_used, false) then
    raise exception 'This rate has been used in financial records. Close it and create a replacement instead.';
  end if;

  v_currency := upper(coalesce(p_currency, v_existing.currency));
  if v_currency not in ('EUR', 'USD') then
    raise exception 'Unsupported currency: %', v_currency;
  end if;

  if coalesce(p_amount, v_existing.amount) <= 0 then
    raise exception 'Rate amount must be positive';
  end if;

  perform public.validate_team_member_rate_overlap(
    p_rate_id,
    v_existing.person_id,
    coalesce(p_project_id, v_existing.project_id),
    coalesce(p_work_type, v_existing.work_type),
    coalesce(p_is_default, v_existing.is_default),
    coalesce(p_effective_from, v_existing.effective_from),
    coalesce(p_effective_to, v_existing.effective_to)
  );

  update public.team_member_rates
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    description = coalesce(p_description, description),
    rate_type = coalesce(p_rate_type, rate_type),
    amount = coalesce(p_amount, amount),
    currency = v_currency,
    project_id = coalesce(p_project_id, project_id),
    work_type = coalesce(nullif(trim(p_work_type), ''), work_type),
    is_default = coalesce(p_is_default, is_default),
    effective_from = coalesce(p_effective_from, effective_from),
    effective_to = coalesce(p_effective_to, effective_to),
    notes = coalesce(p_notes, notes),
    status = public.compute_team_member_rate_status(
      coalesce(p_effective_from, effective_from),
      coalesce(p_effective_to, effective_to)
    )
  where id = p_rate_id
  returning * into v_rate;

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- end_team_member_rate
-- ---------------------------------------------------------------------------
create or replace function public.end_team_member_rate(
  p_rate_id uuid,
  p_effective_to date default current_date
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
    raise exception 'Only super admins can manage compensation rates';
  end if;

  update public.team_member_rates
  set
    effective_to = p_effective_to,
    status = public.compute_team_member_rate_status(effective_from, p_effective_to)
  where id = p_rate_id
    and (effective_to is null or effective_to > p_effective_to)
  returning * into v_rate;

  if not found then
    raise exception 'Rate not found or already ended';
  end if;

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- replace_team_member_rate — close old + create new (for used rates)
-- ---------------------------------------------------------------------------
create or replace function public.replace_team_member_rate(
  p_rate_id uuid,
  p_new_effective_from date,
  p_name text default null,
  p_rate_type text default null,
  p_amount numeric default null,
  p_currency text default null,
  p_description text default null,
  p_notes text default null
)
returns public.team_member_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.team_member_rates;
  v_new public.team_member_rates;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can manage compensation rates';
  end if;

  select * into v_old from public.team_member_rates where id = p_rate_id;
  if not found then
    raise exception 'Rate not found';
  end if;

  if p_new_effective_from <= v_old.effective_from then
    raise exception 'Replacement effective date must be after the original start date';
  end if;

  update public.team_member_rates
  set
    effective_to = (p_new_effective_from - interval '1 day')::date,
    status = public.compute_team_member_rate_status(
      effective_from,
      (p_new_effective_from - interval '1 day')::date
    )
  where id = p_rate_id;

  v_new := public.create_team_member_rate(
    v_old.person_id,
    coalesce(nullif(trim(p_name), ''), v_old.name),
    coalesce(p_rate_type, v_old.rate_type),
    coalesce(p_amount, v_old.amount),
    coalesce(p_currency, v_old.currency),
    v_old.project_id,
    v_old.work_type,
    v_old.is_default,
    p_new_effective_from,
    null,
    coalesce(p_description, v_old.description),
    coalesce(p_notes, p_notes)
  );

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_default_team_member_rate
-- ---------------------------------------------------------------------------
create or replace function public.set_default_team_member_rate(p_rate_id uuid)
returns public.team_member_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate public.team_member_rates;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can manage compensation rates';
  end if;

  select * into v_rate from public.team_member_rates where id = p_rate_id;
  if not found then
    raise exception 'Rate not found';
  end if;

  if v_rate.project_id is not null or v_rate.work_type is not null then
    raise exception 'Only rates without project or work type scope can be set as default';
  end if;

  update public.team_member_rates
  set is_default = false
  where person_id = v_rate.person_id and is_default = true;

  update public.team_member_rates
  set is_default = true
  where id = p_rate_id
  returning * into v_rate;

  if v_rate.rate_type = 'hourly' then
    update public.contacts
    set hourly_rate = v_rate.amount, updated_at = now()
    where id = v_rate.person_id;
  end if;

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_team_member_rate — only unused, safe rates
-- ---------------------------------------------------------------------------
create or replace function public.delete_team_member_rate(p_rate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can manage compensation rates';
  end if;

  if public.team_member_rate_is_used(p_rate_id) then
    raise exception 'Cannot delete a rate that has been used in financial records';
  end if;

  delete from public.team_member_rates where id = p_rate_id;
  if not found then
    raise exception 'Rate not found';
  end if;
end;
$$;

revoke all on function public.create_team_member_rate from public;
grant execute on function public.create_team_member_rate(
  uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text
) to authenticated;

revoke all on function public.update_team_member_rate from public;
grant execute on function public.update_team_member_rate(
  uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean
) to authenticated;

revoke all on function public.end_team_member_rate from public;
grant execute on function public.end_team_member_rate(uuid, date) to authenticated;

revoke all on function public.replace_team_member_rate from public;
grant execute on function public.replace_team_member_rate(
  uuid, date, text, text, numeric, text, text, text
) to authenticated;

revoke all on function public.set_default_team_member_rate from public;
grant execute on function public.set_default_team_member_rate(uuid) to authenticated;

revoke all on function public.delete_team_member_rate from public;
grant execute on function public.delete_team_member_rate(uuid) to authenticated;

revoke all on function public.team_member_rate_is_used from public;
grant execute on function public.team_member_rate_is_used(uuid) to authenticated;
