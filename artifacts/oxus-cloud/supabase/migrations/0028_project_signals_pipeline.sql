-- ---------------------------------------------------------------------------
-- Project signals pipeline: normalized signals, threads, AI processing jobs
-- ---------------------------------------------------------------------------

create table if not exists public.project_signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null,
  source_table text,
  source_id uuid,
  external_id text not null,
  actor_name text,
  source_created_at timestamptz,
  title text not null,
  summary text,
  body text,
  signal_type text not null,
  priority text not null default 'medium',
  confidence numeric,
  thread_key text not null,
  action_key text,
  signal_status text not null default 'new',
  is_client_facing boolean not null default false,
  include_in_ai boolean not null default true,
  include_in_client_updates boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_signals_source_type_check
    check (source_type in ('slack', 'clickup', 'manual', 'other')),
  constraint project_signals_signal_status_check
    check (signal_status in ('new', 'processing', 'processed', 'ignored')),
  constraint project_signals_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint project_signals_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint project_signals_external_id_unique unique (external_id)
);

create index if not exists idx_project_signals_project_id on public.project_signals (project_id);
create index if not exists idx_project_signals_thread_key on public.project_signals (thread_key);
create index if not exists idx_project_signals_signal_type on public.project_signals (signal_type);
create index if not exists idx_project_signals_signal_status on public.project_signals (signal_status);
create index if not exists idx_project_signals_source on public.project_signals (source_type, source_id);
create index if not exists idx_project_signals_created_at on public.project_signals (created_at desc);

drop trigger if exists trg_project_signals_updated_at on public.project_signals;
create trigger trg_project_signals_updated_at
  before update on public.project_signals
  for each row execute function public.set_updated_at();

alter table public.project_signals enable row level security;

drop policy if exists "project_signals_team_all" on public.project_signals;
create policy "project_signals_team_all"
  on public.project_signals for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- ---------------------------------------------------------------------------

create table if not exists public.project_signal_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  thread_key text not null,
  source_type text not null,
  current_state text not null default 'open',
  primary_signal_type text,
  latest_signal_id uuid references public.project_signals(id) on delete set null,
  latest_signal_at timestamptz,
  signal_count integer not null default 1,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_signal_threads_source_type_check
    check (source_type in ('slack', 'clickup', 'manual', 'other')),
  constraint project_signal_threads_current_state_check
    check (current_state in ('open', 'resolved', 'ignored', 'unclear')),
  constraint project_signal_threads_project_thread_unique unique (project_id, thread_key)
);

create index if not exists idx_project_signal_threads_project_id on public.project_signal_threads (project_id);
create index if not exists idx_project_signal_threads_state on public.project_signal_threads (current_state);
create index if not exists idx_project_signal_threads_latest_at on public.project_signal_threads (latest_signal_at desc);

drop trigger if exists trg_project_signal_threads_updated_at on public.project_signal_threads;
create trigger trg_project_signal_threads_updated_at
  before update on public.project_signal_threads
  for each row execute function public.set_updated_at();

alter table public.project_signal_threads enable row level security;

drop policy if exists "project_signal_threads_team_all" on public.project_signal_threads;
create policy "project_signal_threads_team_all"
  on public.project_signal_threads for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- ---------------------------------------------------------------------------

create table if not exists public.ai_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  priority text not null default 'medium',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_processing_jobs_job_type_check
    check (job_type in ('analyze_project_signals')),
  constraint ai_processing_jobs_status_check
    check (status in ('queued', 'running', 'completed', 'failed')),
  constraint ai_processing_jobs_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent'))
);

create index if not exists idx_ai_processing_jobs_project_id on public.ai_processing_jobs (project_id);
create index if not exists idx_ai_processing_jobs_status on public.ai_processing_jobs (status);
create index if not exists idx_ai_processing_jobs_created_at on public.ai_processing_jobs (created_at desc);

drop trigger if exists trg_ai_processing_jobs_updated_at on public.ai_processing_jobs;
create trigger trg_ai_processing_jobs_updated_at
  before update on public.ai_processing_jobs
  for each row execute function public.set_updated_at();

alter table public.ai_processing_jobs enable row level security;

drop policy if exists "ai_processing_jobs_team_all" on public.ai_processing_jobs;
create policy "ai_processing_jobs_team_all"
  on public.ai_processing_jobs for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- Allow PM actions sourced from Slack pipeline
alter table public.project_pm_action_items
  drop constraint if exists project_pm_action_items_source_check;

alter table public.project_pm_action_items
  add constraint project_pm_action_items_source_check
  check (source in ('manual', 'ai_status_report', 'clickup_timeline', 'slack'));
