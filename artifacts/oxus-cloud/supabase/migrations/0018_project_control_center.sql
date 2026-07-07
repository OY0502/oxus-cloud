-- ---------------------------------------------------------------------------
-- AI Project Control Center
-- ---------------------------------------------------------------------------

create table if not exists public.project_ai_status_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_type text not null default 'manual',
  period_start timestamptz,
  period_end timestamptz,
  summary text,
  what_changed text[] not null default '{}',
  blockers text[] not null default '{}',
  risks text[] not null default '{}',
  open_questions text[] not null default '{}',
  pm_actions text[] not null default '{}',
  client_updates text[] not null default '{}',
  scope_changes text[] not null default '{}',
  health_recommendation text,
  risk_recommendation text,
  confidence numeric,
  source_event_ids uuid[] not null default '{}',
  raw_response jsonb,
  model text,
  status text not null default 'completed',
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_ai_status_reports_report_type_check
    check (report_type in ('manual', 'daily', 'weekly', 'after_clickup_sync')),
  constraint project_ai_status_reports_status_check
    check (status in ('pending', 'completed', 'failed')),
  constraint project_ai_status_reports_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint project_ai_status_reports_health_recommendation_check
    check (health_recommendation is null or health_recommendation in ('on-track', 'at-risk', 'off-track')),
  constraint project_ai_status_reports_risk_recommendation_check
    check (risk_recommendation is null or risk_recommendation in ('none', 'low', 'medium', 'high'))
);

create index if not exists idx_project_ai_status_reports_project_id
  on public.project_ai_status_reports (project_id);
create index if not exists idx_project_ai_status_reports_created_at
  on public.project_ai_status_reports (created_at desc);
create index if not exists idx_project_ai_status_reports_status
  on public.project_ai_status_reports (status);

drop trigger if exists trg_project_ai_status_reports_updated_at on public.project_ai_status_reports;
create trigger trg_project_ai_status_reports_updated_at
  before update on public.project_ai_status_reports
  for each row execute function public.set_updated_at();

alter table public.project_ai_status_reports enable row level security;

drop policy if exists "project_ai_status_reports_team_all" on public.project_ai_status_reports;
create policy "project_ai_status_reports_team_all"
  on public.project_ai_status_reports for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

create table if not exists public.project_pm_action_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status_report_id uuid references public.project_ai_status_reports(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'general',
  priority text not null default 'medium',
  status text not null default 'open',
  due_date date,
  source text not null default 'ai_status_report',
  source_event_ids uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_pm_action_items_category_check
    check (category in ('client_question', 'developer_followup', 'access_needed', 'scope_clarification', 'risk_review', 'qa_followup', 'general')),
  constraint project_pm_action_items_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint project_pm_action_items_status_check
    check (status in ('open', 'in_progress', 'done', 'dismissed')),
  constraint project_pm_action_items_source_check
    check (source in ('manual', 'ai_status_report', 'clickup_timeline'))
);

create index if not exists idx_project_pm_action_items_project_id
  on public.project_pm_action_items (project_id);
create index if not exists idx_project_pm_action_items_status
  on public.project_pm_action_items (status);
create index if not exists idx_project_pm_action_items_priority
  on public.project_pm_action_items (priority);
create index if not exists idx_project_pm_action_items_created_at
  on public.project_pm_action_items (created_at desc);

drop trigger if exists trg_project_pm_action_items_updated_at on public.project_pm_action_items;
create trigger trg_project_pm_action_items_updated_at
  before update on public.project_pm_action_items
  for each row execute function public.set_updated_at();

alter table public.project_pm_action_items enable row level security;

drop policy if exists "project_pm_action_items_team_all" on public.project_pm_action_items;
create policy "project_pm_action_items_team_all"
  on public.project_pm_action_items for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
