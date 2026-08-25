-- Google import resilience: timed_out status, history cursors, content hashes, source progress rows

alter table public.google_import_runs
  drop constraint if exists google_import_runs_status_check;

alter table public.google_import_runs
  add constraint google_import_runs_status_check check (status in (
    'queued', 'starting', 'running', 'waiting', 'completed', 'completed_with_warnings',
    'failed', 'cancelled', 'timed_out'
  ));

alter table public.google_import_runs
  add column if not exists sync_mode text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cost_metrics jsonb not null default '{}'::jsonb;

update public.google_import_runs
set sync_mode = coalesce(sync_mode, run_type)
where sync_mode is null;

alter table public.google_sync_states
  add column if not exists committed_history_id text,
  add column if not exists pending_history_id text,
  add column if not exists last_incremental_started_at timestamptz,
  add column if not exists last_incremental_completed_at timestamptz;

update public.google_sync_states
set committed_history_id = coalesce(committed_history_id, history_id)
where history_id is not null;

alter table public.google_gmail_threads
  add column if not exists content_hash text,
  add column if not exists last_processed_at timestamptz,
  add column if not exists last_ai_processed_at timestamptz,
  add column if not exists prompt_version text,
  add column if not exists model_version text,
  add column if not exists result_version text;

create table if not exists public.google_import_source_runs (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.google_import_runs(id) on delete cascade,
  source text not null,
  status text not null default 'queued',
  current_stage text,
  processed_count integer not null default 0,
  discovered_count integer not null default 0,
  ignored_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  candidate_count integer not null default 0,
  error_count integer not null default 0,
  current_cursor text,
  pending_cursor text,
  last_heartbeat_at timestamptz,
  trigger_run_id text,
  error_code text,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_run_id, source),
  constraint google_import_source_runs_status_check check (
    status in ('queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'timed_out', 'cancelled', 'skipped')
  ),
  constraint google_import_source_runs_source_check check (
    source in ('contacts', 'calendar', 'gmail', 'crm_resolution', 'enrichment')
  )
);

create index if not exists idx_google_import_source_runs_run
  on public.google_import_source_runs (import_run_id, status);

drop trigger if exists trg_google_import_source_runs_updated_at on public.google_import_source_runs;
create trigger trg_google_import_source_runs_updated_at
  before update on public.google_import_source_runs
  for each row execute function public.set_updated_at();

-- Reconcile currently stuck production runs (root Trigger timeout with no terminal DB state)
update public.google_import_runs
set
  status = 'timed_out',
  progress_stage = 'failed',
  error_code = 'MAX_DURATION_EXCEEDED',
  error = 'Initial import timed out. Completed work was preserved. Retry will continue from the last checkpoint.',
  failed_at = coalesce(failed_at, now()),
  completed_at = coalesce(completed_at, now()),
  last_heartbeat_at = coalesce(last_heartbeat_at, now()),
  updated_at = now()
where status in ('queued', 'starting', 'running', 'waiting')
  and (
    last_heartbeat_at is null
    or last_heartbeat_at < now() - interval '15 minutes'
  );
