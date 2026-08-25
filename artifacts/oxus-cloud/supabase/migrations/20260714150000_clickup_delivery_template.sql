-- ---------------------------------------------------------------------------
-- OXUS ClickUp Delivery Template tracking and setup execution log
-- ---------------------------------------------------------------------------

alter table public.project_clickup_links
  add column if not exists clickup_template_version integer,
  add column if not exists clickup_setup_status text,
  add column if not exists clickup_setup_audited_at timestamptz,
  add column if not exists clickup_setup_updated_at timestamptz,
  add column if not exists clickup_setup_snapshot jsonb,
  add column if not exists clickup_setup_warnings jsonb not null default '[]'::jsonb,
  add column if not exists clickup_setup_error text,
  add column if not exists clickup_setup_updated_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_project_clickup_links_setup_status
  on public.project_clickup_links (clickup_setup_status);

create table if not exists public.clickup_setup_executions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  clickup_space_id text not null,
  previous_template_version integer,
  target_template_version integer not null,
  status text not null default 'running',
  planned_changes jsonb not null default '{}'::jsonb,
  applied_changes jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint clickup_setup_executions_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed'))
);

create index if not exists idx_clickup_setup_executions_project_id
  on public.clickup_setup_executions (project_id);
create index if not exists idx_clickup_setup_executions_space_id
  on public.clickup_setup_executions (clickup_space_id);
create index if not exists idx_clickup_setup_executions_created_at
  on public.clickup_setup_executions (started_at desc);

create unique index if not exists uq_clickup_setup_executions_idempotency
  on public.clickup_setup_executions (project_id, clickup_space_id, target_template_version)
  where status in ('succeeded', 'partial');

alter table public.clickup_setup_executions enable row level security;

drop policy if exists "clickup_setup_executions_team_all" on public.clickup_setup_executions;
create policy "clickup_setup_executions_team_all"
  on public.clickup_setup_executions for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.clickup_setup_executions is
  'Audit trail for OXUS ClickUp Delivery Template setup updates. No OAuth tokens stored.';
