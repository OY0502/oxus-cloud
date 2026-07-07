-- ---------------------------------------------------------------------------
-- Agent architecture: runs, tool audit, pgvector embeddings, retrieval RPC
-- ---------------------------------------------------------------------------

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- project_agent_runs
-- ---------------------------------------------------------------------------
create table if not exists public.project_agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  input_summary text,
  detected_intent text,
  status text not null default 'pending'
    check (status in (
      'pending', 'running', 'needs_confirmation', 'needs_clarification',
      'confirmed', 'succeeded', 'failed', 'cancelled'
    )),
  result_summary text,
  clarification_questions jsonb not null default '[]'::jsonb,
  tool_run_ids uuid[] not null default '{}',
  created_source_ids uuid[] not null default '{}',
  created_task_ids uuid[] not null default '{}',
  created_doc_ids uuid[] not null default '{}',
  trigger_run_id text,
  raw_response jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_project_agent_runs_project_id
  on public.project_agent_runs (project_id);
create index if not exists idx_project_agent_runs_status
  on public.project_agent_runs (status);
create index if not exists idx_project_agent_runs_created_at
  on public.project_agent_runs (created_at desc);

alter table public.project_agent_runs enable row level security;

drop policy if exists "project_agent_runs_team_all" on public.project_agent_runs;
create policy "project_agent_runs_team_all"
  on public.project_agent_runs for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.project_agent_runs is
  'Audit trail for Project Intelligence agent runs. Not chat history.';

-- ---------------------------------------------------------------------------
-- agent_tool_runs
-- ---------------------------------------------------------------------------
create table if not exists public.agent_tool_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  agent_run_id uuid references public.project_agent_runs(id) on delete set null,
  tool_name text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'needs_confirmation', 'confirmed', 'running',
      'succeeded', 'failed', 'cancelled'
    )),
  requires_confirmation boolean not null default false,
  confirmed_at timestamptz,
  trigger_run_id text,
  input_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_agent_tool_runs_project_id
  on public.agent_tool_runs (project_id);
create index if not exists idx_agent_tool_runs_agent_run_id
  on public.agent_tool_runs (agent_run_id);
create index if not exists idx_agent_tool_runs_status
  on public.agent_tool_runs (status);
create index if not exists idx_agent_tool_runs_created_at
  on public.agent_tool_runs (created_at desc);

alter table public.agent_tool_runs enable row level security;

drop policy if exists "agent_tool_runs_team_all" on public.agent_tool_runs;
create policy "agent_tool_runs_team_all"
  on public.agent_tool_runs for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.agent_tool_runs is
  'Server-side tool execution audit with human confirmation for side effects.';

-- ---------------------------------------------------------------------------
-- pgvector on project_knowledge_chunks
-- ---------------------------------------------------------------------------
alter table public.project_knowledge_chunks
  add column if not exists embedding vector(1536),
  add column if not exists embedding_model text,
  add column if not exists embedded_at timestamptz;

create index if not exists idx_project_knowledge_chunks_embedding_hnsw
  on public.project_knowledge_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on column public.project_knowledge_chunks.embedding is
  'OpenAI text-embedding-3-small vector (1536 dims). Project-scoped retrieval only.';

-- ---------------------------------------------------------------------------
-- Bridge ai_processing_jobs to Trigger.dev
-- ---------------------------------------------------------------------------
alter table public.ai_processing_jobs
  add column if not exists trigger_run_id text;

-- Expand knowledge source types for agent-created docs
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'project_knowledge_sources_source_type_check'
      and conrelid = 'public.project_knowledge_sources'::regclass
  ) then
    alter table public.project_knowledge_sources
      drop constraint project_knowledge_sources_source_type_check;
  end if;

  alter table public.project_knowledge_sources
    add constraint project_knowledge_sources_source_type_check
    check (source_type in (
      'manual', 'uploaded_file', 'zoom_transcript', 'project_description',
      'figma', 'clickup', 'clickup_doc', 'slack', 'other',
      'meeting_transcript', 'slack_summary', 'client_feedback',
      'requirements_doc', 'design_notes', 'qa_notes', 'technical_notes',
      'delivery_update', 'unknown', 'agent'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- Vector similarity search (project-scoped, security definer)
-- ---------------------------------------------------------------------------
create or replace function public.match_project_knowledge_chunks(
  p_project_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 10
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_project_id is null then
    raise exception 'p_project_id is required';
  end if;

  if not public.is_team_member() then
    raise exception 'not authorized';
  end if;

  return query
  select
    c.id,
    c.source_id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.project_knowledge_chunks c
  where c.project_id = p_project_id
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 10), 50));
end;
$$;

revoke all on function public.match_project_knowledge_chunks(uuid, vector, int) from public;
grant execute on function public.match_project_knowledge_chunks(uuid, vector, int) to authenticated;
