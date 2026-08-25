-- Google sync batch architecture: resumable cursors, heartbeats, Gmail thread staging

alter table public.google_import_runs
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists source_progress jsonb not null default '{}'::jsonb,
  add column if not exists current_source text,
  add column if not exists failed_stage text;

create index if not exists idx_google_import_runs_heartbeat
  on public.google_import_runs (last_heartbeat_at desc nulls last)
  where status in ('queued', 'starting', 'running', 'waiting');

-- Staged Gmail threads for discovery → relevance → AI processing pipeline
create table if not exists public.google_gmail_threads (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  import_run_id uuid references public.google_import_runs(id) on delete set null,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id text not null,
  subject text,
  snippet text,
  last_message_at timestamptz,
  participant_emails text[] not null default '{}'::text[],
  labels text[] not null default '{}'::text[],
  has_external_participant boolean not null default false,
  relevance_status text not null default 'discovered',
  relevance_reason text,
  message_count integer not null default 0,
  processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_gmail_threads_relevance_status_check check (
    relevance_status in ('discovered', 'relevant', 'ignored', 'processed', 'failed')
  ),
  unique (connection_id, thread_id)
);

create index if not exists idx_google_gmail_threads_import_run
  on public.google_gmail_threads (import_run_id, relevance_status)
  where processed_at is null;

create index if not exists idx_google_gmail_threads_connection_pending
  on public.google_gmail_threads (connection_id, relevance_status, created_at)
  where processed_at is null;

drop trigger if exists trg_google_gmail_threads_updated_at on public.google_gmail_threads;
create trigger trg_google_gmail_threads_updated_at
  before update on public.google_gmail_threads
  for each row execute function public.set_updated_at();

-- Idempotent batch checkpoint per import run + source + cursor
create table if not exists public.google_import_batch_checkpoints (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.google_import_runs(id) on delete cascade,
  source text not null,
  cursor_key text not null default '',
  status text not null default 'completed',
  processed_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (import_run_id, source, cursor_key)
);

create index if not exists idx_google_import_batch_checkpoints_run
  on public.google_import_batch_checkpoints (import_run_id, source);
