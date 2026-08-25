-- Project archive lifecycle + PandaDoc document provider fields.
-- Archive retains history; delete remains a separate permanent action.

-- ---------------------------------------------------------------------------
-- Project archive audit fields
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists idx_projects_archived_at
  on public.projects (archived_at)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- Extend attachments for external document providers (PandaDoc)
-- ---------------------------------------------------------------------------
alter table public.attachments
  alter column file_path drop not null;

alter table public.attachments
  add column if not exists provider text not null default 'upload',
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists status text,
  add column if not exists title text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_synced_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_id uuid references public.attachments(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attachments_provider_check'
  ) then
    alter table public.attachments
      add constraint attachments_provider_check
      check (provider in ('upload', 'pandadoc'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attachments_provider_payload_check'
  ) then
    alter table public.attachments
      add constraint attachments_provider_payload_check
      check (
        (provider = 'upload' and file_path is not null and file_name is not null)
        or
        (provider = 'pandadoc' and external_id is not null)
      );
  end if;
end $$;

-- Allow file_name to remain required for uploads; for PandaDoc fill from document name.
alter table public.attachments
  alter column file_name drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attachments_file_name_required_for_upload'
  ) then
    alter table public.attachments
      add constraint attachments_file_name_required_for_upload
      check (
        provider <> 'upload'
        or (file_name is not null and length(trim(file_name)) > 0)
      );
  end if;
end $$;

create unique index if not exists idx_attachments_provider_external_unique
  on public.attachments (entity_type, entity_id, provider, external_id)
  where provider <> 'upload' and external_id is not null;

create index if not exists idx_attachments_external_id
  on public.attachments (provider, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- PandaDoc integration state (safe diagnostics; no secrets)
-- ---------------------------------------------------------------------------
create table if not exists public.pandadoc_integration_state (
  id uuid primary key default gen_random_uuid(),
  configured boolean not null default false,
  workspace_name text,
  last_successful_sync_at timestamptz,
  last_sync_error text,
  webhook_last_received_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.pandadoc_integration_state (configured)
select false
where not exists (select 1 from public.pandadoc_integration_state limit 1);

alter table public.pandadoc_integration_state enable row level security;

drop policy if exists pandadoc_integration_state_select on public.pandadoc_integration_state;
create policy pandadoc_integration_state_select on public.pandadoc_integration_state
  for select to authenticated using (public.is_super_admin());

drop policy if exists pandadoc_integration_state_write on public.pandadoc_integration_state;
create policy pandadoc_integration_state_write on public.pandadoc_integration_state
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- PandaDoc webhook idempotency
-- ---------------------------------------------------------------------------
create table if not exists public.pandadoc_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text,
  document_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_pandadoc_webhook_events_document
  on public.pandadoc_webhook_events (document_id);

alter table public.pandadoc_webhook_events enable row level security;

-- No client access — service role only.
drop policy if exists pandadoc_webhook_events_deny on public.pandadoc_webhook_events;
create policy pandadoc_webhook_events_deny on public.pandadoc_webhook_events
  for all to authenticated using (false) with check (false);

-- Allow system lifecycle events on the unified timeline.
alter table public.project_timeline_events
  drop constraint if exists project_timeline_events_source_type_check;

alter table public.project_timeline_events
  add constraint project_timeline_events_source_type_check
  check (source_type in (
    'slack', 'clickup', 'pm_action', 'zoom', 'figma', 'github',
    'manual', 'ai', 'other', 'company_website', 'system', 'pandadoc'
  ));

-- ---------------------------------------------------------------------------
-- Archive / restore RPCs (PM or super_admin)
-- ---------------------------------------------------------------------------
create or replace function public.archive_project(
  p_project_id uuid,
  p_reason text default null
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_user_id uuid := auth.uid();
begin
  if not public.is_pm_or_super_admin() then
    raise exception 'Only PM or super admin can archive projects';
  end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.archived_at is not null then
    return v_project;
  end if;

  update public.projects
  set
    archived_at = now(),
    archived_by = v_user_id,
    archive_reason = nullif(trim(coalesce(p_reason, '')), ''),
    updated_at = now()
  where id = p_project_id
  returning * into v_project;

  insert into public.project_timeline_events (
    project_id,
    source_type,
    event_type,
    event_title,
    event_summary,
    actor_name,
    priority,
    visibility,
    metadata
  )
  select
    p_project_id,
    'system',
    'project_archived',
    'Project archived',
    coalesce(
      nullif(trim(coalesce(p_reason, '')), ''),
      'Project was archived and hidden from active views.'
    ),
    coalesce(pr.full_name, pr.email, 'System'),
    'medium',
    'internal',
    jsonb_build_object(
      'archive_reason', nullif(trim(coalesce(p_reason, '')), ''),
      'archived_by', v_user_id
    )
  from (select 1) _
  left join public.profiles pr on pr.id = v_user_id;

  return v_project;
end;
$$;

create or replace function public.restore_project(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_user_id uuid := auth.uid();
begin
  if not public.is_pm_or_super_admin() then
    raise exception 'Only PM or super admin can restore projects';
  end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.archived_at is null then
    return v_project;
  end if;

  update public.projects
  set
    archived_at = null,
    archived_by = null,
    archive_reason = null,
    updated_at = now()
  where id = p_project_id
  returning * into v_project;

  insert into public.project_timeline_events (
    project_id,
    source_type,
    event_type,
    event_title,
    event_summary,
    actor_name,
    priority,
    visibility,
    metadata
  )
  select
    p_project_id,
    'system',
    'project_restored',
    'Project restored',
    'Project was restored to active views.',
    coalesce(pr.full_name, pr.email, 'System'),
    'medium',
    'internal',
    jsonb_build_object('restored_by', v_user_id)
  from (select 1) _
  left join public.profiles pr on pr.id = v_user_id;

  return v_project;
end;
$$;

revoke all on function public.archive_project(uuid, text) from public;
revoke all on function public.restore_project(uuid) from public;
grant execute on function public.archive_project(uuid, text) to authenticated;
grant execute on function public.restore_project(uuid) to authenticated;
