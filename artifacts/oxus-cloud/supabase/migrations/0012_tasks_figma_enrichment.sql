-- ---------------------------------------------------------------------------
-- Richer internal tasks, design-aware AI proposed tasks, and Figma references
-- ---------------------------------------------------------------------------

-- Part 2: enrich internal tasks with PM/developer context.
alter table public.tasks
  add column if not exists description text,
  add column if not exists priority text not null default 'medium',
  add column if not exists acceptance_criteria text[] not null default '{}',
  add column if not exists qa_scenarios jsonb not null default '[]'::jsonb,
  add column if not exists implementation_notes text[] not null default '{}',
  add column if not exists design_notes text[] not null default '{}',
  add column if not exists estimate_hours numeric,
  add column if not exists source_type text,
  add column if not exists source_ai_proposed_task_id uuid references public.ai_proposed_tasks(id) on delete set null,
  add column if not exists source_ai_brief_id uuid references public.ai_project_briefs(id) on delete set null,
  add column if not exists source_knowledge_source_id uuid references public.project_knowledge_sources(id) on delete set null,
  add column if not exists figma_file_key text,
  add column if not exists figma_node_ids text[] not null default '{}',
  add column if not exists design_url text,
  add column if not exists external_provider text,
  add column if not exists external_id text,
  add column if not exists external_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_priority_check' and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_priority_check
      check (priority in ('low', 'medium', 'high', 'urgent'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_source_type_check' and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_source_type_check
      check (source_type is null or source_type in ('manual', 'ai_proposed_task', 'figma', 'clickup', 'slack', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_estimate_hours_check' and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_estimate_hours_check
      check (estimate_hours is null or estimate_hours >= 0);
  end if;
end $$;

create index if not exists idx_tasks_source_ai_proposed_task_id on public.tasks (source_ai_proposed_task_id);
create index if not exists idx_tasks_source_knowledge_source_id on public.tasks (source_knowledge_source_id);
create index if not exists idx_tasks_figma_file_key on public.tasks (figma_file_key);
create index if not exists idx_tasks_external_provider_id on public.tasks (external_provider, external_id);
create index if not exists idx_tasks_priority on public.tasks (priority);

-- Part 3: design references on AI proposed tasks.
alter table public.ai_proposed_tasks
  add column if not exists implementation_notes text[] not null default '{}',
  add column if not exists design_notes text[] not null default '{}',
  add column if not exists estimate_hours numeric,
  add column if not exists source_knowledge_source_id uuid references public.project_knowledge_sources(id) on delete set null,
  add column if not exists figma_file_key text,
  add column if not exists figma_node_ids text[] not null default '{}',
  add column if not exists design_url text;

create index if not exists idx_ai_proposed_tasks_source_knowledge_source_id on public.ai_proposed_tasks (source_knowledge_source_id);
create index if not exists idx_ai_proposed_tasks_figma_file_key on public.ai_proposed_tasks (figma_file_key);

-- Part 4: Figma references linked to a project.
create table if not exists public.project_figma_references (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  figma_url text not null,
  file_key text not null,
  node_id text,
  title text,
  description text,
  last_imported_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_key)
);
create index if not exists idx_project_figma_references_project_id on public.project_figma_references (project_id);
create index if not exists idx_project_figma_references_file_key on public.project_figma_references (file_key);
create index if not exists idx_project_figma_references_created_at on public.project_figma_references (created_at);

drop trigger if exists trg_project_figma_references_updated_at on public.project_figma_references;
create trigger trg_project_figma_references_updated_at
  before update on public.project_figma_references
  for each row execute function public.set_updated_at();

alter table public.project_figma_references enable row level security;

drop policy if exists "project_figma_references_team_all" on public.project_figma_references;
create policy "project_figma_references_team_all"
  on public.project_figma_references for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
