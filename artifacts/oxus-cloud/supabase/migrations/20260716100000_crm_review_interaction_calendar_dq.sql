-- CRM review workspace + interaction-date semantics + calendar historical recovery cursors
-- Corrective migration (does not edit prior applied migrations).

-- Attendee-level cancellation for recurring instance handling
alter table public.google_calendar_attendees
  add column if not exists cancelled_at timestamptz;

-- ---------------------------------------------------------------------------
-- Historical recovery cursors (separate from incremental sync_token)
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_historical_cursors (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  calendar_id text not null,
  operation_id uuid not null default gen_random_uuid(),
  time_min timestamptz not null,
  time_max timestamptz not null,
  page_token text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  events_read integer not null default 0,
  events_stored integer not null default 0,
  attendees_seen integer not null default 0,
  dry_run boolean not null default false,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, calendar_id, operation_id)
);

create index if not exists idx_google_cal_hist_cursors_conn_status
  on public.google_calendar_historical_cursors (connection_id, status);

alter table public.google_calendar_historical_cursors enable row level security;

drop policy if exists "google_cal_hist_cursors_select" on public.google_calendar_historical_cursors;
create policy "google_cal_hist_cursors_select"
  on public.google_calendar_historical_cursors for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin());

create unique index if not exists idx_crm_entity_candidates_pending_matched_person
  on public.crm_entity_candidates (owner_user_id, entity_type, matched_person_id)
  where status = 'pending' and matched_person_id is not null;

create unique index if not exists idx_crm_entity_candidates_pending_matched_company
  on public.crm_entity_candidates (owner_user_id, entity_type, matched_company_id)
  where status = 'pending' and matched_company_id is not null;

-- ---------------------------------------------------------------------------
-- Canonical interaction-date recalculation (UTC, database now())
-- ---------------------------------------------------------------------------
create or replace function public.recalculate_crm_interaction_dates(
  p_owner_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people_updated integer := 0;
  v_companies_updated integer := 0;
  v_future_cleared_people integer := 0;
  v_future_cleared_companies integer := 0;
begin
  update public.contacts
  set last_interaction_at = null, updated_at = now()
  where last_interaction_at > now()
    and (p_owner_user_id is null or relationship_owner_id = p_owner_user_id);
  get diagnostics v_future_cleared_people = row_count;

  update public.clients
  set last_interaction_at = null, updated_at = now()
  where last_interaction_at > now()
    and (p_owner_user_id is null or relationship_owner_id = p_owner_user_id);
  get diagnostics v_future_cleared_companies = row_count;

  -- People: last past attendee/interaction; next future non-cancelled meeting
  with person_past as (
    select person_id, max(ts) as last_at
    from (
      select a.canonical_person_id as person_id, a.event_start_at as ts
      from public.google_calendar_attendees a
      where a.exclusion_reason is null
        and a.canonical_person_id is not null
        and a.event_start_at is not null
        and a.event_start_at <= now()
        and a.cancelled_at is null
      union all
      select unnest(coalesce(gi.person_ids, '{}'::uuid[])), gi.occurred_at
      from public.google_interactions gi
      where gi.occurred_at <= now()
        and gi.interaction_type in ('calendar_event', 'email', 'meeting', 'note')
    ) x
    group by 1
  ),
  person_future as (
    select a.canonical_person_id as person_id, min(a.event_start_at) as next_at
    from public.google_calendar_attendees a
    left join public.calendar_events ce
      on ce.connection_id = a.connection_id
     and ce.external_calendar_id = a.external_calendar_id
     and ce.external_id = a.external_event_id
    where a.exclusion_reason is null
      and a.canonical_person_id is not null
      and a.event_start_at > now()
      and a.cancelled_at is null
      and ce.cancelled_at is null
    group by 1
  )
  update public.contacts c
  set
    last_interaction_at = pp.last_at,
    last_contact_at = case when pp.last_at is not null then (pp.last_at at time zone 'utc')::date else c.last_contact_at end,
    next_meeting_at = pf.next_at,
    updated_at = now()
  from person_past pp
  full outer join person_future pf on pf.person_id = pp.person_id
  where c.id = coalesce(pp.person_id, pf.person_id)
    and c.archived_at is null
    and c.soft_deleted_at is null
    and (p_owner_user_id is null or c.relationship_owner_id = p_owner_user_id)
    and (
      c.last_interaction_at is distinct from pp.last_at
      or c.next_meeting_at is distinct from pf.next_at
    );
  get diagnostics v_people_updated = row_count;

  -- Companies: past/future from interactions + linked people (never from internal-only domain noise in writers)
  with company_past as (
    select company_id, max(ts) as last_at
    from (
      select gi.company_id, gi.occurred_at as ts
      from public.google_interactions gi
      where gi.company_id is not null
        and gi.occurred_at <= now()
        and gi.interaction_type in ('calendar_event', 'email', 'meeting', 'note')
      union all
      select p.client_id, a.event_start_at
      from public.google_calendar_attendees a
      join public.contacts p on p.id = a.canonical_person_id
      where a.exclusion_reason is null
        and p.client_id is not null
        and a.event_start_at <= now()
        and a.cancelled_at is null
    ) x
    group by 1
  ),
  company_future as (
    select company_id, min(ts) as next_at
    from (
      select gi.company_id, gi.occurred_at as ts
      from public.google_interactions gi
      left join public.calendar_events ce
        on ce.connection_id = gi.connection_id
       and ce.external_id = gi.external_id
      where gi.company_id is not null
        and gi.interaction_type = 'calendar_event'
        and gi.occurred_at > now()
        and ce.cancelled_at is null
      union all
      select p.client_id, a.event_start_at
      from public.google_calendar_attendees a
      join public.contacts p on p.id = a.canonical_person_id
      left join public.calendar_events ce
        on ce.connection_id = a.connection_id
       and ce.external_calendar_id = a.external_calendar_id
       and ce.external_id = a.external_event_id
      where a.exclusion_reason is null
        and p.client_id is not null
        and a.event_start_at > now()
        and a.cancelled_at is null
        and ce.cancelled_at is null
    ) x
    group by 1
  )
  update public.clients cl
  set
    last_interaction_at = cp.last_at,
    next_meeting_at = cf.next_at,
    updated_at = now()
  from company_past cp
  full outer join company_future cf on cf.company_id = cp.company_id
  where cl.id = coalesce(cp.company_id, cf.company_id)
    and cl.archived_at is null
    and cl.soft_deleted_at is null
    and (p_owner_user_id is null or cl.relationship_owner_id = p_owner_user_id)
    and (
      cl.last_interaction_at is distinct from cp.last_at
      or cl.next_meeting_at is distinct from cf.next_at
    );
  get diagnostics v_companies_updated = row_count;

  update public.contacts
  set next_meeting_at = null, updated_at = now()
  where next_meeting_at is not null and next_meeting_at <= now();

  update public.clients
  set next_meeting_at = null, updated_at = now()
  where next_meeting_at is not null and next_meeting_at <= now();

  return jsonb_build_object(
    'people_updated', v_people_updated,
    'companies_updated', v_companies_updated,
    'future_last_interaction_cleared_people', v_future_cleared_people,
    'future_last_interaction_cleared_companies', v_future_cleared_companies,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.recalculate_crm_interaction_dates(uuid) from public;
grant execute on function public.recalculate_crm_interaction_dates(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Unified review workspace view
-- ---------------------------------------------------------------------------
create or replace view public.crm_review_workspace_v
with (security_invoker = true)
as
with pending_candidates as (
  select
    c.id,
    c.owner_user_id,
    c.connection_id,
    c.entity_type,
    c.status,
    c.display_name,
    c.email,
    c.domain,
    c.website,
    c.job_title,
    c.company_name,
    c.suggested_company_type,
    c.suggested_relationship_type,
    c.confidence,
    c.evidence,
    c.sources,
    c.reason,
    c.matched_company_id,
    c.matched_person_id,
    c.created_entity_id,
    c.metadata,
    c.created_at,
    c.updated_at,
    ('candidate:' || c.id::text) as review_identity,
    case
      when c.matched_person_id is not null or c.matched_company_id is not null then 'existing_needs_review'
      else 'new_suggestion'
    end as review_kind,
    coalesce(c.reason, 'New Google-derived suggestion') as review_reason
  from public.crm_entity_candidates c
  where c.status = 'pending'
),
canonical_people as (
  select
    p.id,
    coalesce(p.relationship_owner_id, '00000000-0000-0000-0000-000000000000'::uuid) as owner_user_id,
    null::uuid as connection_id,
    'person'::text as entity_type,
    'pending'::text as status,
    coalesce(p.display_name, p.name) as display_name,
    p.email,
    null::text as domain,
    null::text as website,
    p.job_title,
    p.company as company_name,
    null::text as suggested_company_type,
    p.relationship_type as suggested_relationship_type,
    coalesce(p.import_confidence, p.identity_confidence, 0.5)::numeric(4,3) as confidence,
    jsonb_build_object('canonical_person_id', p.id, 'quality_reason', p.quality_reason) as evidence,
    coalesce(p.aggregated_sources, array[coalesce(p.source, 'CRM')]::text[]) as sources,
    coalesce(p.quality_reason, 'Existing record needs review') as reason,
    p.client_id as matched_company_id,
    p.id as matched_person_id,
    p.id as created_entity_id,
    jsonb_build_object('review_source', 'canonical_person') as metadata,
    p.created_at,
    p.updated_at,
    ('person:' || p.id::text) as review_identity,
    'existing_needs_review'::text as review_kind,
    coalesce(
      p.quality_reason,
      case
        when coalesce(p.is_role_inbox, false) then 'Role inbox needs confirmation'
        when p.client_id is null then 'Uncertain company association'
        else 'Existing record needs review'
      end
    ) as review_reason
  from public.contacts p
  where p.archived_at is null
    and p.soft_deleted_at is null
    and coalesce(p.visibility_state, 'active') not in ('suppressed', 'merged', 'inactive')
    and (
      p.visibility_state = 'needs_review'
      or p.data_quality_status = 'needs_review'
    )
    and not exists (
      select 1 from public.crm_entity_candidates c
      where c.status = 'pending'
        and c.entity_type = 'person'
        and (
          c.matched_person_id = p.id
          or (p.email is not null and c.email is not null and lower(c.email) = lower(p.email))
        )
    )
),
canonical_companies as (
  select
    co.id,
    coalesce(co.relationship_owner_id, '00000000-0000-0000-0000-000000000000'::uuid) as owner_user_id,
    null::uuid as connection_id,
    'company'::text as entity_type,
    'pending'::text as status,
    coalesce(co.display_name, co.name) as display_name,
    null::text as email,
    coalesce(co.registrable_domain, co.primary_domain) as domain,
    co.website,
    null::text as job_title,
    coalesce(co.display_name, co.name) as company_name,
    co.company_type as suggested_company_type,
    null::text as suggested_relationship_type,
    coalesce(co.import_confidence, 0.5)::numeric(4,3) as confidence,
    jsonb_build_object('canonical_company_id', co.id, 'quality_reason', co.quality_reason) as evidence,
    coalesce(co.aggregated_sources, array[coalesce(co.source, 'CRM')]::text[]) as sources,
    coalesce(co.quality_reason, 'Existing company needs review') as reason,
    co.id as matched_company_id,
    null::uuid as matched_person_id,
    co.id as created_entity_id,
    jsonb_build_object('review_source', 'canonical_company') as metadata,
    co.created_at,
    co.updated_at,
    ('company:' || co.id::text) as review_identity,
    case
      when coalesce(co.company_type, 'unknown') in ('unknown', '') then 'missing_classification'
      else 'existing_needs_review'
    end as review_kind,
    coalesce(
      co.quality_reason,
      case
        when coalesce(co.company_type, 'unknown') in ('unknown', '') then 'Unknown relationship'
        else 'Existing company needs review'
      end
    ) as review_reason
  from public.clients co
  where co.archived_at is null
    and co.soft_deleted_at is null
    and coalesce(co.visibility_state, 'active') not in ('suppressed', 'merged', 'inactive')
    and (
      co.visibility_state = 'needs_review'
      or co.data_quality_status = 'needs_review'
      or co.needs_review = true
    )
    and not exists (
      select 1 from public.crm_entity_candidates c
      where c.status = 'pending'
        and c.entity_type = 'company'
        and (
          c.matched_company_id = co.id
          or (
            coalesce(co.registrable_domain, co.primary_domain) is not null
            and c.domain is not null
            and lower(c.domain) = lower(coalesce(co.registrable_domain, co.primary_domain))
          )
        )
    )
)
select * from pending_candidates
union all
select * from canonical_people
union all
select * from canonical_companies;

comment on view public.crm_review_workspace_v is
  'Unified CRM review workspace: pending import candidates + canonical records needing review, deduplicated.';
