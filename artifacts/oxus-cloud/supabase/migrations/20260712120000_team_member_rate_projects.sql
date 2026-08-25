-- Multi-project team member rates via normalized join table.

-- ---------------------------------------------------------------------------
-- Join table
-- ---------------------------------------------------------------------------
create table if not exists public.team_member_rate_projects (
  id uuid primary key default gen_random_uuid(),
  rate_id uuid not null
    references public.team_member_rates(id)
    on delete cascade,
  project_id uuid not null
    references public.projects(id)
    on delete cascade,
  created_at timestamptz not null default now(),
  unique(rate_id, project_id)
);

create index if not exists idx_team_member_rate_projects_rate_id
  on public.team_member_rate_projects (rate_id);

create index if not exists idx_team_member_rate_projects_project_id
  on public.team_member_rate_projects (project_id);

alter table public.team_member_rate_projects enable row level security;

drop policy if exists team_member_rate_projects_all on public.team_member_rate_projects;
create policy team_member_rate_projects_all on public.team_member_rate_projects
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Backfill legacy project_id associations (idempotent)
-- ---------------------------------------------------------------------------
insert into public.team_member_rate_projects (rate_id, project_id)
select r.id, r.project_id
from public.team_member_rates r
where r.project_id is not null
  and not exists (
    select 1
    from public.team_member_rate_projects trp
    where trp.rate_id = r.id
      and trp.project_id = r.project_id
  );

do $$
declare
  v_migrated_count int;
begin
  select count(*) into v_migrated_count
  from public.team_member_rate_projects;
  raise notice 'team_member_rate_projects rows after migration: %', v_migrated_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Auto-end project-scoped rates that lose all project links
-- ---------------------------------------------------------------------------
create or replace function public.handle_team_member_rate_project_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate_id uuid;
  v_remaining int;
  v_rate public.team_member_rates;
begin
  v_rate_id := old.rate_id;

  select count(*) into v_remaining
  from public.team_member_rate_projects
  where rate_id = v_rate_id;

  if v_remaining = 0 then
    select * into v_rate from public.team_member_rates where id = v_rate_id;
    if found and not v_rate.is_default and v_rate.effective_to is null then
      update public.team_member_rates
      set
        effective_to = current_date,
        status = public.compute_team_member_rate_status(v_rate.effective_from, current_date),
        description = coalesce(v_rate.description || E'\n', '')
          || 'Auto-ended: no linked projects remain.'
      where id = v_rate_id;
    end if;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_team_member_rate_project_removed on public.team_member_rate_projects;
create trigger trg_team_member_rate_project_removed
  after delete on public.team_member_rate_projects
  for each row
  execute function public.handle_team_member_rate_project_removed();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.rate_has_project_links(p_rate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_member_rate_projects where rate_id = p_rate_id
  );
$$;

create or replace function public.sync_team_member_rate_projects(
  p_rate_id uuid,
  p_project_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid[];
  v_to_add uuid[];
  v_to_remove uuid[];
begin
  select coalesce(array_agg(project_id), '{}')
  into v_existing
  from public.team_member_rate_projects
  where rate_id = p_rate_id;

  v_to_add := coalesce(
    array(
      select unnest(coalesce(p_project_ids, '{}'))
      except
      select unnest(v_existing)
    ),
    '{}'
  );

  v_to_remove := coalesce(
    array(
      select unnest(v_existing)
      except
      select unnest(coalesce(p_project_ids, '{}'))
    ),
    '{}'
  );

  if array_length(v_to_remove, 1) is not null then
    delete from public.team_member_rate_projects
    where rate_id = p_rate_id
      and project_id = any(v_to_remove);
  end if;

  insert into public.team_member_rate_projects (rate_id, project_id)
  select p_rate_id, pid
  from unnest(v_to_add) as pid
  on conflict (rate_id, project_id) do nothing;
end;
$$;

create or replace function public.check_team_member_rate_conflicts(
  p_id uuid,
  p_person_id uuid,
  p_project_ids uuid[],
  p_work_type text,
  p_is_default boolean,
  p_effective_from date,
  p_effective_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conflicts jsonb := '[]'::jsonb;
  v_norm_work_type text;
begin
  if coalesce(p_is_default, false) then
    return v_conflicts;
  end if;

  v_norm_work_type := coalesce(lower(trim(p_work_type)), '');

  if p_project_ids is not null and array_length(p_project_ids, 1) > 0 then
    select coalesce(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb)
    into v_conflicts
    from (
      select distinct
        pid as project_id,
        pr.name as project_name,
        r.id as conflicting_rate_id,
        r.name as conflicting_rate_name,
        r.effective_from,
        r.effective_to
      from unnest(p_project_ids) as pid
      join public.projects pr on pr.id = pid
      join public.team_member_rate_projects trp on trp.project_id = pid
      join public.team_member_rates r on r.id = trp.rate_id
      where r.person_id = p_person_id
        and (p_id is null or r.id <> p_id)
        and not r.is_default
        and coalesce(lower(trim(r.work_type)), '') = v_norm_work_type
        and public.rate_is_active_on_date(r.effective_from, r.effective_to, greatest(p_effective_from, current_date))
        and (p_effective_to is null or r.effective_from <= p_effective_to)
        and (r.effective_to is null or r.effective_to >= p_effective_from)
    ) c;
  elsif v_norm_work_type <> '' then
    select coalesce(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb)
    into v_conflicts
    from (
      select
        null::uuid as project_id,
        null::text as project_name,
        r.id as conflicting_rate_id,
        r.name as conflicting_rate_name,
        r.effective_from,
        r.effective_to
      from public.team_member_rates r
      where r.person_id = p_person_id
        and (p_id is null or r.id <> p_id)
        and not r.is_default
        and coalesce(lower(trim(r.work_type)), '') = v_norm_work_type
        and not public.rate_has_project_links(r.id)
        and r.project_id is null
        and public.rate_is_active_on_date(r.effective_from, r.effective_to, greatest(p_effective_from, current_date))
        and (p_effective_to is null or r.effective_from <= p_effective_to)
        and (r.effective_to is null or r.effective_to >= p_effective_from)
      limit 1
    ) c;
  end if;

  return jsonb_build_object('conflicts', coalesce(v_conflicts, '[]'::jsonb));
end;
$$;

create or replace function public.validate_team_member_rate_overlap(
  p_id uuid,
  p_person_id uuid,
  p_project_ids uuid[],
  p_work_type text,
  p_is_default boolean,
  p_effective_from date,
  p_effective_to date
)
returns void
language plpgsql
as $$
declare
  v_conflict jsonb;
  v_conflict_count int;
begin
  if coalesce(p_is_default, false) then
    select id into v_conflict
    from public.team_member_rates
    where person_id = p_person_id
      and is_default = true
      and (p_id is null or id <> p_id)
      and public.rate_is_active_on_date(effective_from, effective_to, greatest(p_effective_from, current_date))
      and (p_effective_to is null or effective_from <= p_effective_to)
      and (effective_to is null or effective_to >= p_effective_from)
    limit 1;
    if v_conflict is not null then
      raise exception 'An active default rate already exists for this period';
    end if;
    return;
  end if;

  select check_team_member_rate_conflicts(
    p_id, p_person_id, p_project_ids, p_work_type, p_is_default, p_effective_from, p_effective_to
  ) into v_conflict;

  select jsonb_array_length(v_conflict->'conflicts') into v_conflict_count;

  if coalesce(v_conflict_count, 0) > 0 then
    raise exception 'RATE_CONFLICT:%', v_conflict::text;
  end if;
end;
$$;

-- Backwards-compatible overload for legacy callers still passing single project_id
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
begin
  perform public.validate_team_member_rate_overlap(
    p_id,
    p_person_id,
    case when p_project_id is null then null else array[p_project_id] end,
    p_work_type,
    p_is_default,
    p_effective_from,
    p_effective_to
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_team_member_rate — accepts project_ids array, stops writing project_id
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
  p_notes text default null,
  p_project_ids uuid[] default null
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
  v_project_ids uuid[];
  v_norm_work_type text;
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

  v_norm_work_type := nullif(trim(p_work_type), '');
  v_project_ids := coalesce(
    p_project_ids,
    case when p_project_id is not null then array[p_project_id] else null end
  );
  v_is_default := coalesce(p_is_default, false);

  if v_is_default then
    v_project_ids := null;
    v_norm_work_type := null;
  elsif v_project_ids is not null and array_length(v_project_ids, 1) > 0 then
    null;
  elsif v_norm_work_type is not null then
    v_project_ids := null;
  else
    raise exception 'Select at least one project for this rate.';
  end if;

  perform public.validate_team_member_rate_overlap(
    null, p_person_id, v_project_ids, v_norm_work_type, v_is_default, p_effective_from, p_effective_to
  );

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
    null,
    v_norm_work_type,
    v_is_default,
    p_effective_from,
    p_effective_to,
    p_notes,
    public.compute_team_member_rate_status(p_effective_from, p_effective_to)
  )
  returning * into v_rate;

  if v_project_ids is not null and array_length(v_project_ids, 1) > 0 then
    insert into public.team_member_rate_projects (rate_id, project_id)
    select v_rate.id, pid
    from unnest(v_project_ids) as pid
    on conflict (rate_id, project_id) do nothing;
  end if;

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
-- update_team_member_rate
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
  p_allow_used boolean default false,
  p_project_ids uuid[] default null
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
  v_project_ids uuid[];
  v_norm_work_type text;
  v_is_default boolean;
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

  v_norm_work_type := coalesce(nullif(trim(p_work_type), ''), v_existing.work_type);
  v_is_default := coalesce(p_is_default, v_existing.is_default);

  if p_project_ids is not null then
    v_project_ids := p_project_ids;
  else
    select coalesce(array_agg(project_id), '{}')
    into v_project_ids
    from public.team_member_rate_projects
    where rate_id = p_rate_id;

    if (v_project_ids is null or array_length(v_project_ids, 1) is null) and v_existing.project_id is not null then
      v_project_ids := array[v_existing.project_id];
    end if;
  end if;

  if p_project_id is not null and (p_project_ids is null) then
    v_project_ids := array[p_project_id];
  end if;

  if v_is_default then
    v_project_ids := null;
  elsif v_norm_work_type is not null and (v_project_ids is null or array_length(v_project_ids, 1) is null) then
    v_project_ids := null;
  elsif not v_is_default and v_norm_work_type is null
    and (v_project_ids is null or array_length(v_project_ids, 1) is null) then
    raise exception 'Select at least one project for this rate.';
  end if;

  perform public.validate_team_member_rate_overlap(
    p_rate_id,
    v_existing.person_id,
    v_project_ids,
    v_norm_work_type,
    v_is_default,
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
    project_id = null,
    work_type = v_norm_work_type,
    is_default = v_is_default,
    effective_from = coalesce(p_effective_from, effective_from),
    effective_to = coalesce(p_effective_to, effective_to),
    notes = coalesce(p_notes, notes),
    status = public.compute_team_member_rate_status(
      coalesce(p_effective_from, effective_from),
      coalesce(p_effective_to, effective_to)
    )
  where id = p_rate_id
  returning * into v_rate;

  perform public.sync_team_member_rate_projects(p_rate_id, coalesce(v_project_ids, '{}'));

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- replace_team_member_rate — copy project links to replacement
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
  v_project_ids uuid[];
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

  select coalesce(array_agg(project_id), '{}')
  into v_project_ids
  from public.team_member_rate_projects
  where rate_id = p_rate_id;

  if (v_project_ids is null or array_length(v_project_ids, 1) is null) and v_old.project_id is not null then
    v_project_ids := array[v_old.project_id];
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
    null,
    v_old.work_type,
    v_old.is_default,
    p_new_effective_from,
    null,
    coalesce(p_description, v_old.description),
    coalesce(p_notes, p_notes),
    v_project_ids
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

  if public.rate_has_project_links(p_rate_id) or v_rate.work_type is not null then
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

revoke all on function public.sync_team_member_rate_projects(uuid, uuid[]) from public;
grant execute on function public.sync_team_member_rate_projects(uuid, uuid[]) to authenticated;

revoke all on function public.check_team_member_rate_conflicts(uuid, uuid, uuid[], text, boolean, date, date) from public;
grant execute on function public.check_team_member_rate_conflicts(uuid, uuid, uuid[], text, boolean, date, date) to authenticated;

revoke all on function public.create_team_member_rate(
  uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text, uuid[]
) from public;
grant execute on function public.create_team_member_rate(
  uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text, uuid[]
) to authenticated;

revoke all on function public.update_team_member_rate(
  uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean, uuid[]
) from public;
grant execute on function public.update_team_member_rate(
  uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean, uuid[]
) to authenticated;
