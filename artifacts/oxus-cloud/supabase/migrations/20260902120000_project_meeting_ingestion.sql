-- Durable, resumable ingestion for large batches of meeting recordings.

-- The application enforces this same per-file limit before creating a batch.
-- Supabase's project-level Storage limit still remains the final platform cap.
update storage.buckets
set file_size_limit = 1073741824
where id = 'documents'
  and (file_size_limit is null or file_size_limit < 1073741824);

create table if not exists public.project_meeting_ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chat_session_id uuid references public.project_chat_sessions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'partial', 'failed', 'cancelled')),
  file_count integer not null default 0 check (file_count between 0 and 20),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  user_message text,
  trigger_run_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_meeting_ingestion_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.project_meeting_ingestion_batches(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  derived_attachment_id uuid references public.attachments(id) on delete set null,
  agent_run_id uuid references public.project_agent_runs(id) on delete set null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  status text not null default 'queued'
    check (status in ('queued', 'downloading', 'transcribing', 'analyzing', 'completed', 'failed')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  transcript_chars integer not null default 0 check (transcript_chars >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, attachment_id)
);

create index if not exists project_meeting_batches_project_recent_idx
  on public.project_meeting_ingestion_batches(project_id, created_at desc);
create index if not exists project_meeting_batches_active_idx
  on public.project_meeting_ingestion_batches(project_id, status)
  where status in ('queued', 'processing');
create index if not exists project_meeting_items_batch_idx
  on public.project_meeting_ingestion_items(batch_id, created_at);

drop trigger if exists trg_project_meeting_batches_updated_at on public.project_meeting_ingestion_batches;
create trigger trg_project_meeting_batches_updated_at
  before update on public.project_meeting_ingestion_batches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_project_meeting_items_updated_at on public.project_meeting_ingestion_items;
create trigger trg_project_meeting_items_updated_at
  before update on public.project_meeting_ingestion_items
  for each row execute function public.set_updated_at();

alter table public.project_meeting_ingestion_batches enable row level security;
alter table public.project_meeting_ingestion_items enable row level security;

drop policy if exists "Team members can read meeting ingestion batches" on public.project_meeting_ingestion_batches;
create policy "Team members can read meeting ingestion batches"
  on public.project_meeting_ingestion_batches for select to authenticated
  using (public.is_team_member());

drop policy if exists "Team members can read meeting ingestion items" on public.project_meeting_ingestion_items;
create policy "Team members can read meeting ingestion items"
  on public.project_meeting_ingestion_items for select to authenticated
  using (public.is_team_member());

comment on table public.project_meeting_ingestion_batches is
  'Durable background imports of up to 20 project meeting files. Written by trusted Edge/Trigger workers.';
comment on table public.project_meeting_ingestion_items is
  'Per-file download, transcription, and project-memory analysis status for a meeting ingestion batch.';
