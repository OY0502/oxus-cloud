-- Google import run diagnostics: correlation ID, structured error codes, failed timestamp

alter table public.google_import_runs
  add column if not exists correlation_id uuid,
  add column if not exists error_code text,
  add column if not exists failed_at timestamptz;

-- Release stuck active runs that failed at the worker auth layer before this fix
update public.google_import_runs
set
  status = 'failed',
  progress_stage = 'failed',
  error = coalesce(error, 'Worker authentication failed before sync could start.'),
  error_code = coalesce(error_code, 'INTERNAL_AUTH_INVALID'),
  failed_at = coalesce(failed_at, now()),
  completed_at = coalesce(completed_at, now()),
  updated_at = now()
where status in ('queued', 'starting', 'running', 'waiting')
  and (
    error ilike '%Unauthorized%'
    or error ilike '%google-sync-worker failed (401)%'
    or error ilike '%INTERNAL_AUTH%'
  );
