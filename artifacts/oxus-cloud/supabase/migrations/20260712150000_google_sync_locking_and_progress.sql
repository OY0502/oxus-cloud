-- Google sync locking, progress fields, and realtime for live CRM updates

alter table public.google_import_runs
  add column if not exists progress_processed integer,
  add column if not exists progress_total integer,
  add column if not exists progress_percentage numeric(5,2);

alter table public.google_import_runs
  drop constraint if exists google_import_runs_status_check;

alter table public.google_import_runs
  add constraint google_import_runs_status_check check (status in (
    'queued', 'starting', 'running', 'waiting', 'completed', 'completed_with_warnings', 'failed', 'cancelled'
  ));

-- Resolve stale active runs so the partial unique index can be created safely.
-- Keep only the newest active run per connection; mark older stuck runs as failed.
with ranked_active as (
  select
    id,
    row_number() over (
      partition by connection_id
      order by coalesce(started_at, created_at) desc, created_at desc
    ) as rn
  from public.google_import_runs
  where status in ('queued', 'running')
)
update public.google_import_runs r
set
  status = 'failed',
  progress_stage = 'failed',
  error = coalesce(r.error, 'Superseded by a newer sync run during migration.'),
  completed_at = coalesce(r.completed_at, now()),
  updated_at = now()
from ranked_active ra
where r.id = ra.id
  and ra.rn > 1;

-- One active import/sync run per Google connection (server-side idempotency)
create unique index if not exists idx_google_import_runs_one_active_per_connection
  on public.google_import_runs (connection_id)
  where status in ('queued', 'starting', 'running', 'waiting');

-- Live progress updates on CRM page
do $$
begin
  alter publication supabase_realtime add table public.google_import_runs;
exception
  when duplicate_object then null;
end $$;
