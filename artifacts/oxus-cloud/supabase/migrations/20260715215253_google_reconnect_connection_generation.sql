-- Google reconnect: connection generation + durable operation identity.
-- Preserves existing CRM data and source checkpoints.

alter table public.user_google_connections
  add column if not exists connection_generation bigint not null default 1;

comment on column public.user_google_connections.connection_generation is
  'Incremented on disconnect/reconnect so in-flight workers and import runs can detect obsolete generations.';

alter table public.google_import_runs
  add column if not exists connection_generation bigint;

alter table public.google_import_runs
  add column if not exists operation_identity text;

alter table public.google_import_runs
  add column if not exists interrupted_at timestamptz;

alter table public.google_import_runs
  add column if not exists dispatch_status text;

comment on column public.google_import_runs.connection_generation is
  'Connection generation this import was created for. Workers must refuse writes when it no longer matches.';

comment on column public.google_import_runs.operation_identity is
  'Stable operation identity used for Trigger.dev idempotency and reconnect-safe dispatch.';

comment on column public.google_import_runs.interrupted_at is
  'When an active import was interrupted by disconnect/reconnect.';

comment on column public.google_import_runs.dispatch_status is
  'queued_pending_dispatch | dispatched | dispatch_failed | null for legacy rows.';

-- Backfill generations onto historical runs from their connection.
update public.google_import_runs gir
set connection_generation = coalesce(ugc.connection_generation, 1)
from public.user_google_connections ugc
where gir.connection_id = ugc.id
  and gir.connection_generation is null;

create index if not exists idx_google_import_runs_connection_generation
  on public.google_import_runs (connection_id, connection_generation);

create unique index if not exists idx_google_import_runs_operation_identity_active
  on public.google_import_runs (operation_identity)
  where operation_identity is not null
    and status in ('queued', 'starting', 'running', 'waiting');

create or replace view public.user_google_connections_safe as
select
  id, user_id, google_account_id, google_email, granted_scopes, token_expires_at,
  status, sources_enabled, import_settings, connected_at, disconnected_at,
  last_successful_sync_at, last_sync_error, metadata, created_at, updated_at,
  contacts_last_synced_at, calendar_last_synced_at, gmail_last_synced_at,
  sync_incident_dismissed_at, crm_resolver_version, connection_generation
from public.user_google_connections;

grant select on public.user_google_connections_safe to authenticated;
