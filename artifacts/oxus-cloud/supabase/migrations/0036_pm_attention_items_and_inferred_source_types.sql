-- PM attention items (clarification questions from memory intake)
-- and expanded inferred knowledge source types

-- ---------------------------------------------------------------------------
-- Expand project_knowledge_sources source_type values
-- ---------------------------------------------------------------------------
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
      'figma', 'clickup', 'slack', 'other',
      'meeting_transcript', 'slack_summary', 'client_feedback',
      'requirements_doc', 'design_notes', 'qa_notes', 'technical_notes',
      'delivery_update', 'unknown'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- project_pm_attention_items
-- ---------------------------------------------------------------------------
create table if not exists public.project_pm_attention_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  question text not null,
  reason text,
  importance text not null default 'medium'
    check (importance in ('low', 'medium', 'high')),
  blocks_task_creation boolean not null default false,
  status text not null default 'open'
    check (status in ('open', 'answered', 'skipped', 'cleared')),
  source_memory_run_id uuid references public.ai_project_briefs(id) on delete set null,
  source_knowledge_source_id uuid references public.project_knowledge_sources(id) on delete set null,
  answer_text text,
  question_key text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  cleared_at timestamptz,
  cleared_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_pm_attention_items_project_id
  on public.project_pm_attention_items (project_id);
create index if not exists idx_pm_attention_items_project_status
  on public.project_pm_attention_items (project_id, status);
create index if not exists idx_pm_attention_items_question_key
  on public.project_pm_attention_items (project_id, question_key);

alter table public.project_pm_attention_items enable row level security;

drop policy if exists "project_pm_attention_items_team_all" on public.project_pm_attention_items;
create policy "project_pm_attention_items_team_all"
  on public.project_pm_attention_items for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.project_pm_attention_items is
  'Clarification questions surfaced by Project Intelligence memory intake. Not chat history.';
