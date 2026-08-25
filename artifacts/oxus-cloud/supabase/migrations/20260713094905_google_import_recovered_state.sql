-- Recovered/resumed Google import state and historical error preservation

alter table public.google_import_runs
  add column if not exists recovered_at timestamptz,
  add column if not exists resumed_at timestamptz,
  add column if not exists resumed_from_trigger_run_id text,
  add column if not exists last_historical_error_code text,
  add column if not exists last_historical_error_message text,
  add column if not exists import_history jsonb not null default '[]'::jsonb;

comment on column public.google_import_runs.recovered_at is
  'When an interrupted import was detected as actively continuing again.';
comment on column public.google_import_runs.resumed_at is
  'When the user or system explicitly resumed from a checkpoint.';
comment on column public.google_import_runs.last_historical_error_code is
  'Most recent non-current interruption code preserved for diagnostics.';
comment on column public.google_import_runs.import_history is
  'Chronological import events for the details drawer.';

-- Preserve existing interruption diagnostics before clearing current errors.
update public.google_import_runs
set
  last_historical_error_code = coalesce(last_historical_error_code, error_code),
  last_historical_error_message = coalesce(last_historical_error_message, error)
where error_code is not null
  and last_historical_error_code is null;

-- Recover imports that are still progressing but were left in a terminal interruption state.
update public.google_import_runs
set
  status = 'running',
  progress_stage = case
    when progress_stage is null or progress_stage in ('failed', 'queued') then 'resolving_people'
    else progress_stage
  end,
  last_historical_error_code = coalesce(last_historical_error_code, error_code),
  last_historical_error_message = coalesce(last_historical_error_message, error),
  error_code = null,
  error = null,
  failed_at = null,
  completed_at = null,
  failed_stage = null,
  recovered_at = coalesce(recovered_at, now()),
  resumed_at = coalesce(resumed_at, now()),
  import_history = coalesce(import_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'event', 'recovered',
      'detail', coalesce(error_code, 'INTERRUPTED') || ' preserved as historical diagnostics while active work continues.'
    )
  ),
  updated_at = now()
where status in ('timed_out', 'failed')
  and last_heartbeat_at is not null
  and last_heartbeat_at > now() - interval '45 minutes'
  and coalesce(progress_stage, '') not in ('completed', 'completed_with_warnings', 'failed')
  and (
    coalesce((counts->>'people_updated')::int, 0) > 0
    or coalesce((counts->>'people_created')::int, 0) > 0
    or coalesce((counts->>'candidates_created')::int, 0) > 0
    or progress_stage in (
      'resolving_people', 'resolving_companies', 'resolving_entities',
      'resolving_basic_people', 'resolving_basic_companies',
      'discovering_gmail_threads', 'processing_gmail_threads',
      'syncing_contacts', 'syncing_calendar', 'syncing_gmail',
      'filtering_relationship_threads', 'analyzing_relationships',
      'creating_candidates', 'enriching_companies', 'finalizing'
    )
  );
