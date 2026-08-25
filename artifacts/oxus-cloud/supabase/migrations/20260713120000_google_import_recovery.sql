-- Google import automatic recovery and finalization tracking

alter table public.google_import_runs
  add column if not exists action_required boolean not null default false,
  add column if not exists recovery_status text not null default 'idle',
  add column if not exists next_retry_at timestamptz,
  add column if not exists retry_count integer not null default 0,
  add column if not exists retry_task_run_id text,
  add column if not exists finalization_started_at timestamptz,
  add column if not exists finalization_heartbeat_at timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists last_reconciliation_outcome text;

alter table public.google_import_runs
  drop constraint if exists google_import_runs_recovery_status_check;

alter table public.google_import_runs
  add constraint google_import_runs_recovery_status_check check (
    recovery_status in ('idle', 'retrying', 'recovering', 'needs_attention')
  );

comment on column public.google_import_runs.recovery_status is
  'Automatic recovery lifecycle for orchestration/finalization failures.';
comment on column public.google_import_runs.next_retry_at is
  'When the next Trigger.dev retry or watchdog recovery is scheduled.';
comment on column public.google_import_runs.finalization_heartbeat_at is
  'Heartbeat while google-complete-core-sync is active or retrying.';

-- Imports paused only by stale watchdog while entity resolution already completed.
update public.google_import_runs
set
  status = 'running',
  progress_stage = 'completing_core_sync',
  core_sync_status = 'running',
  error_code = null,
  error = null,
  failed_at = null,
  completed_at = null,
  failed_stage = null,
  action_required = false,
  recovery_status = 'recovering',
  last_historical_error_code = coalesce(last_historical_error_code, error_code),
  last_historical_error_message = coalesce(last_historical_error_message, error),
  import_history = coalesce(import_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'event', 'recovery_queued',
      'detail', 'Core entity resolution completed; awaiting automatic finalization retry.'
    )
  ),
  updated_at = now()
where id = '96ad1d16-65e0-4e3e-9272-53f07ca594ee'
  and status in ('timed_out', 'failed')
  and coalesce(source_progress->'resolve'->>'completed', 'false') = 'true'
  and coalesce(source_progress->'core'->>'completed', 'false') = 'false';
