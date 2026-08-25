-- Centralized AI task specification generation: technical profile, runs, research cache, feedback

alter table public.project_pm_profiles
  add column if not exists technical_profile jsonb not null default '{}'::jsonb;

comment on column public.project_pm_profiles.technical_profile is
  'Structured technical profile: stack, auth model, languages, integrations, constraints.';

create table if not exists public.ai_tech_research_cache (
  id uuid primary key default gen_random_uuid(),
  technology_key text not null,
  query_type text not null default 'general',
  source_url text not null,
  source_title text,
  extracted_facts text[] not null default '{}',
  content_hash text,
  retrieved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'ok' check (status in ('ok', 'failed', 'stale')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ai_tech_research_cache_key
  on public.ai_tech_research_cache (technology_key, query_type, source_url);
create index if not exists idx_ai_tech_research_cache_expires
  on public.ai_tech_research_cache (expires_at);

create table if not exists public.ai_task_generation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null,
  source_ids jsonb not null default '[]'::jsonb,
  request text not null,
  intent jsonb,
  structured_spec jsonb,
  markdown_description text,
  quality_scores jsonb,
  quality_score numeric check (quality_score is null or quality_score between 0 and 100),
  quality_warnings text[] not null default '{}',
  needs_review boolean not null default false,
  prompt_versions jsonb not null default '{}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  research_used boolean not null default false,
  research_domains text[] not null default '{}',
  regeneration_count integer not null default 0,
  duplicate_detection jsonb,
  outcome text not null default 'generated'
    check (outcome in ('generated', 'needs_review', 'duplicate_skipped', 'no_task_needed', 'failed')),
  latency_ms integer,
  token_usage jsonb,
  estimated_cost_usd numeric,
  langfuse_trace_id text,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_task_generation_runs_project
  on public.ai_task_generation_runs (project_id, created_at desc);

alter table public.ai_proposed_tasks
  add column if not exists generation_run_id uuid references public.ai_task_generation_runs(id) on delete set null,
  add column if not exists structured_spec jsonb,
  add column if not exists markdown_description text,
  add column if not exists quality_score numeric check (quality_score is null or quality_score between 0 and 100),
  add column if not exists quality_warnings text[] not null default '{}',
  add column if not exists needs_review boolean not null default false,
  add column if not exists edit_diff jsonb,
  add column if not exists generation_outcome text;

create index if not exists idx_ai_proposed_tasks_generation_run
  on public.ai_proposed_tasks (generation_run_id);

create table if not exists public.ai_task_generation_feedback (
  id uuid primary key default gen_random_uuid(),
  generation_run_id uuid references public.ai_task_generation_runs(id) on delete cascade,
  ai_proposed_task_id uuid references public.ai_proposed_tasks(id) on delete cascade,
  signal text not null check (signal in (
    'accepted_without_edit', 'accepted_after_edit', 'rejected', 'created_in_clickup',
    'dismissed', 'duplicate_detected', 'regenerated'
  )),
  edit_diff jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_task_generation_feedback_run
  on public.ai_task_generation_feedback (generation_run_id);
create index if not exists idx_ai_task_generation_feedback_task
  on public.ai_task_generation_feedback (ai_proposed_task_id);

alter table public.ai_tech_research_cache enable row level security;
alter table public.ai_task_generation_runs enable row level security;
alter table public.ai_task_generation_feedback enable row level security;

drop policy if exists "ai_tech_research_cache_team_all" on public.ai_tech_research_cache;
create policy "ai_tech_research_cache_team_all"
  on public.ai_tech_research_cache for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "ai_task_generation_runs_team_all" on public.ai_task_generation_runs;
create policy "ai_task_generation_runs_team_all"
  on public.ai_task_generation_runs for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "ai_task_generation_feedback_team_all" on public.ai_task_generation_feedback;
create policy "ai_task_generation_feedback_team_all"
  on public.ai_task_generation_feedback for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
