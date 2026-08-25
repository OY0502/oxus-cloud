-- Split Google import into fast core CRM sync vs background relationship enrichment.

alter table public.google_import_runs
  add column if not exists core_sync_status text not null default 'pending',
  add column if not exists enrichment_status text not null default 'pending',
  add column if not exists enrichment_paused_at timestamptz,
  add column if not exists processor_version integer not null default 1,
  add column if not exists workflow_version integer not null default 2;

alter table public.google_import_runs
  drop constraint if exists google_import_runs_core_sync_status_check;

alter table public.google_import_runs
  add constraint google_import_runs_core_sync_status_check check (
    core_sync_status in ('pending', 'running', 'complete', 'failed')
  );

alter table public.google_import_runs
  drop constraint if exists google_import_runs_enrichment_status_check;

alter table public.google_import_runs
  add constraint google_import_runs_enrichment_status_check check (
    enrichment_status in (
      'pending', 'running', 'complete', 'completed_with_warnings', 'paused', 'failed', 'skipped'
    )
  );

alter table public.google_gmail_threads
  add column if not exists enrichment_status text not null default 'pending',
  add column if not exists relationship_group_id uuid,
  add column if not exists deterministic_resolved_at timestamptz,
  add column if not exists enrichment_priority integer not null default 0,
  add column if not exists two_way_conversation boolean not null default false;

alter table public.google_gmail_threads
  drop constraint if exists google_gmail_threads_enrichment_status_check;

alter table public.google_gmail_threads
  add constraint google_gmail_threads_enrichment_status_check check (
    enrichment_status in (
      'pending', 'noise', 'metadata_resolved', 'queued', 'grouped', 'enriched', 'skipped', 'failed', 'deferred'
    )
  );

create table if not exists public.google_relationship_groups (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  import_run_id uuid references public.google_import_runs(id) on delete set null,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  group_key text not null,
  normalized_external_email text not null,
  person_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.clients(id) on delete set null,
  thread_ids text[] not null default '{}'::text[],
  thread_count integer not null default 0,
  priority_score integer not null default 0,
  content_hash text,
  status text not null default 'pending',
  last_enriched_at timestamptz,
  analysis_version text,
  prompt_version text,
  model_version text,
  ai_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, group_key),
  constraint google_relationship_groups_status_check check (
    status in ('pending', 'queued', 'processing', 'enriched', 'skipped', 'failed', 'deferred')
  )
);

create index if not exists idx_google_relationship_groups_import_run
  on public.google_relationship_groups (import_run_id, status)
  where status in ('pending', 'queued', 'processing');

create index if not exists idx_google_relationship_groups_connection_pending
  on public.google_relationship_groups (connection_id, status, priority_score desc)
  where status in ('pending', 'queued');

create index if not exists idx_google_gmail_threads_enrichment_pending
  on public.google_gmail_threads (connection_id, enrichment_status, enrichment_priority desc)
  where enrichment_status in ('pending', 'queued', 'grouped');

drop trigger if exists trg_google_relationship_groups_updated_at on public.google_relationship_groups;
create trigger trg_google_relationship_groups_updated_at
  before update on public.google_relationship_groups
  for each row execute function public.set_updated_at();

-- Reconcile the currently stuck production import (gmail-only incremental, AI cap loop).
update public.google_import_runs r
set
  processor_version = 2,
  workflow_version = 2,
  core_sync_status = case
    when coalesce(r.source_progress->'gmail'->>'discovery_completed', 'false') = 'true' then 'running'
    else 'pending'
  end,
  enrichment_status = case
    when coalesce(r.source_progress->'gmail'->>'discovery_completed', 'false') = 'true' then 'running'
    else 'pending'
  end,
  progress_stage = 'resolving_basic_people',
  counts = coalesce(r.counts, '{}'::jsonb)
    || jsonb_build_object(
      'threads_deferred',
      coalesce((r.counts->>'email_threads_processed')::int, 0)
        + (
          select count(*)::int
          from public.google_gmail_threads t
          where t.connection_id = r.connection_id
            and t.relevance_status = 'relevant'
            and t.processed_at is null
        ),
      'relationship_groups_queued', 0,
      'relationship_groups_processed', 0,
      'threads_used_for_ai', coalesce((r.counts->>'ai_threads_processed')::int, 0),
      'threads_skipped_as_noise', coalesce((r.counts->>'ignored_records')::int, 0)
    ),
  source_progress = coalesce(r.source_progress, '{}'::jsonb)
    || jsonb_build_object(
      'gmail', coalesce(r.source_progress->'gmail', '{}'::jsonb)
        || jsonb_build_object('processing_completed', true, 'core_metadata_completed', false),
      'core', jsonb_build_object('completed', false),
      'resolve', jsonb_build_object('completed', false),
      'enrichment', jsonb_build_object('filter_completed', false, 'grouping_completed', false, 'completed', false)
    ),
  updated_at = now()
where r.id = '96ad1d16-65e0-4e3e-9272-53f07ca594ee'
  and r.status in ('queued', 'starting', 'running', 'waiting');

-- Mark already-AI-processed threads; reset unprocessed relevant threads for enrichment pipeline.
update public.google_gmail_threads t
set
  enrichment_status = case
    when t.processed_at is not null then 'enriched'
    when t.relevance_status = 'ignored' then 'noise'
    else 'pending'
  end,
  relevance_status = case
    when t.processed_at is not null then 'processed'
    when t.relevance_status = 'relevant' and t.processed_at is null then 'relevant'
    else t.relevance_status
  end
where t.connection_id = (
  select connection_id from public.google_import_runs where id = '96ad1d16-65e0-4e3e-9272-53f07ca594ee'
);
