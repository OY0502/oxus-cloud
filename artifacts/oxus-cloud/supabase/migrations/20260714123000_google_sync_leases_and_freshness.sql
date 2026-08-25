-- Google sync leases, per-source freshness timestamps, and watchdog indexes

alter table public.user_google_connections
  add column if not exists contacts_last_synced_at timestamptz,
  add column if not exists calendar_last_synced_at timestamptz,
  add column if not exists gmail_last_synced_at timestamptz,
  add column if not exists sync_incident_dismissed_at timestamptz;

create table if not exists public.google_sync_leases (
  lease_key text primary key,
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  sync_type text not null,
  run_id text,
  owner text,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active',
  sync_reason text,
  counters jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_sync_leases_status_check check (status in ('active', 'completed', 'failed', 'expired'))
);

create index if not exists idx_google_sync_leases_connection on public.google_sync_leases (connection_id);
create index if not exists idx_google_sync_leases_expires on public.google_sync_leases (expires_at) where status = 'active';
create index if not exists idx_google_sync_leases_connection_type on public.google_sync_leases (connection_id, sync_type);

create index if not exists idx_google_import_runs_stale_watchdog
  on public.google_import_runs (status, last_heartbeat_at)
  where status in ('queued', 'starting', 'running', 'waiting');

create index if not exists idx_google_import_source_runs_active
  on public.google_import_source_runs (import_run_id, status, last_heartbeat_at);

drop trigger if exists trg_google_sync_leases_updated_at on public.google_sync_leases;
create trigger trg_google_sync_leases_updated_at
  before update on public.google_sync_leases
  for each row execute function public.set_updated_at();

alter table public.google_sync_leases enable row level security;

-- Repair stuck imports where core sync finished but run never finalized.
update public.google_import_runs r
set
  status = 'completed',
  progress_stage = 'completed',
  enrichment_status = coalesce(r.enrichment_status, 'skipped'),
  completed_at = coalesce(r.completed_at, now()),
  last_heartbeat_at = now(),
  action_required = false,
  recovery_status = 'idle',
  error = null,
  error_code = null,
  updated_at = now()
where r.core_sync_status = 'complete'
  and r.status in ('queued', 'starting', 'running', 'waiting')
  and (
    r.last_heartbeat_at is null
    or r.last_heartbeat_at < now() - interval '25 minutes'
  );

-- Release expired active leases (safe cleanup)
update public.google_sync_leases
set status = 'expired', updated_at = now()
where status = 'active' and expires_at < now();

create or replace view public.user_google_connections_safe as
select
  id, user_id, google_account_id, google_email, granted_scopes, token_expires_at,
  status, sources_enabled, import_settings, connected_at, disconnected_at,
  last_successful_sync_at, last_sync_error, metadata, created_at, updated_at,
  contacts_last_synced_at, calendar_last_synced_at, gmail_last_synced_at,
  sync_incident_dismissed_at
from public.user_google_connections;
