-- ---------------------------------------------------------------------------
-- PM project snapshots (current state + client update draft)
-- ---------------------------------------------------------------------------

create table if not exists public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_type text not null default 'manual',
  summary text,
  current_phase text,
  health text,
  risk text,
  progress_summary text,
  active_blockers text[] not null default '{}',
  resolved_blockers text[] not null default '{}',
  open_questions text[] not null default '{}',
  decisions text[] not null default '{}',
  scope_changes text[] not null default '{}',
  recent_progress text[] not null default '{}',
  stale_items text[] not null default '{}',
  next_pm_actions text[] not null default '{}',
  client_update_draft text,
  internal_notes text[] not null default '{}',
  source_report_ids uuid[] not null default '{}',
  source_event_ids uuid[] not null default '{}',
  source_action_item_ids uuid[] not null default '{}',
  confidence numeric,
  model text,
  raw_response jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_snapshots_snapshot_type_check
    check (snapshot_type in ('manual', 'daily', 'weekly', 'client_update')),
  constraint project_snapshots_health_check
    check (health is null or health in ('on-track', 'at-risk', 'off-track')),
  constraint project_snapshots_risk_check
    check (risk is null or risk in ('none', 'low', 'medium', 'high')),
  constraint project_snapshots_confidence_check
    check (confidence is null or confidence between 0 and 1)
);

create index if not exists idx_project_snapshots_project_id
  on public.project_snapshots (project_id);
create index if not exists idx_project_snapshots_created_at
  on public.project_snapshots (created_at desc);
create index if not exists idx_project_snapshots_snapshot_type
  on public.project_snapshots (snapshot_type);

drop trigger if exists trg_project_snapshots_updated_at on public.project_snapshots;
create trigger trg_project_snapshots_updated_at
  before update on public.project_snapshots
  for each row execute function public.set_updated_at();

alter table public.project_snapshots enable row level security;

drop policy if exists "project_snapshots_team_all" on public.project_snapshots;
create policy "project_snapshots_team_all"
  on public.project_snapshots for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
