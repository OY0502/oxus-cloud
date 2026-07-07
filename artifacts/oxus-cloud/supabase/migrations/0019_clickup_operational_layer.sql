-- ---------------------------------------------------------------------------
-- ClickUp member cache, richer AI task creation options, PM action execution
-- ---------------------------------------------------------------------------

create table if not exists public.clickup_members (
  id uuid primary key default gen_random_uuid(),
  clickup_team_id text not null,
  clickup_user_id text not null,
  username text,
  email text,
  initials text,
  profile_picture text,
  role text,
  is_active boolean not null default true,
  raw_member jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clickup_team_id, clickup_user_id)
);

create index if not exists idx_clickup_members_team_id on public.clickup_members (clickup_team_id);
create index if not exists idx_clickup_members_user_id on public.clickup_members (clickup_user_id);
create index if not exists idx_clickup_members_email on public.clickup_members (email);
create index if not exists idx_clickup_members_is_active on public.clickup_members (is_active);

drop trigger if exists trg_clickup_members_updated_at on public.clickup_members;
create trigger trg_clickup_members_updated_at
  before update on public.clickup_members
  for each row execute function public.set_updated_at();

alter table public.clickup_members enable row level security;

drop policy if exists "clickup_members_team_all" on public.clickup_members;
create policy "clickup_members_team_all"
  on public.clickup_members for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

alter table public.ai_proposed_tasks
  add column if not exists selected_clickup_assignee_ids text[] not null default '{}',
  add column if not exists selected_due_date date,
  add column if not exists selected_due_date_time boolean not null default false,
  add column if not exists clickup_creation_options jsonb not null default '{}'::jsonb;

alter table public.project_pm_action_items
  add column if not exists action_type text not null default 'manual',
  add column if not exists action_payload jsonb not null default '{}'::jsonb,
  add column if not exists execution_status text not null default 'not_started',
  add column if not exists execution_result jsonb,
  add column if not exists execution_error text,
  add column if not exists executed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_pm_action_items_action_type_check'
      and conrelid = 'public.project_pm_action_items'::regclass
  ) then
    alter table public.project_pm_action_items
      add constraint project_pm_action_items_action_type_check
      check (action_type in (
        'manual', 'create_clickup_task', 'assign_clickup_tasks', 'update_clickup_deadline',
        'add_clickup_comment', 'request_access', 'ask_client_question', 'review_risk', 'review_scope'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'project_pm_action_items_execution_status_check'
      and conrelid = 'public.project_pm_action_items'::regclass
  ) then
    alter table public.project_pm_action_items
      add constraint project_pm_action_items_execution_status_check
      check (execution_status in ('not_started', 'ready', 'running', 'succeeded', 'failed', 'skipped'));
  end if;
end $$;

create index if not exists idx_project_pm_action_items_action_type
  on public.project_pm_action_items (action_type);
create index if not exists idx_project_pm_action_items_execution_status
  on public.project_pm_action_items (execution_status);

create table if not exists public.project_pm_action_executions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  action_item_id uuid references public.project_pm_action_items(id) on delete set null,
  action_type text not null,
  input_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded',
  error_message text,
  clickup_task_ids text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_pm_action_executions_status_check
    check (status in ('succeeded', 'failed', 'partial'))
);

create index if not exists idx_project_pm_action_executions_project_id
  on public.project_pm_action_executions (project_id);
create index if not exists idx_project_pm_action_executions_action_item_id
  on public.project_pm_action_executions (action_item_id);
create index if not exists idx_project_pm_action_executions_action_type
  on public.project_pm_action_executions (action_type);
create index if not exists idx_project_pm_action_executions_created_at
  on public.project_pm_action_executions (created_at desc);

alter table public.project_pm_action_executions enable row level security;

drop policy if exists "project_pm_action_executions_team_all" on public.project_pm_action_executions;
create policy "project_pm_action_executions_team_all"
  on public.project_pm_action_executions for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
