-- ---------------------------------------------------------------------------
-- Durable project PM memory and knowledge sources
-- ---------------------------------------------------------------------------

create table if not exists public.project_pm_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  business_goal text,
  target_users text[] not null default '{}',
  core_flows text[] not null default '{}',
  scope_in text[] not null default '{}',
  scope_out text[] not null default '{}',
  success_criteria text[] not null default '{}',
  assumptions text[] not null default '{}',
  constraints text[] not null default '{}',
  risks text[] not null default '{}',
  open_questions text[] not null default '{}',
  qa_strategy text,
  technical_notes text[] not null default '{}',
  delivery_notes text[] not null default '{}',
  current_phase text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  last_source_id uuid,
  last_ai_brief_id uuid references public.ai_project_briefs(id) on delete set null,
  raw_profile jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_project_pm_profiles_project_id on public.project_pm_profiles (project_id);
create index if not exists idx_project_pm_profiles_updated_at on public.project_pm_profiles (updated_at);

drop trigger if exists trg_project_pm_profiles_updated_at on public.project_pm_profiles;
create trigger trg_project_pm_profiles_updated_at
  before update on public.project_pm_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.project_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  source_type text not null
    check (source_type in ('manual', 'uploaded_file', 'zoom_transcript', 'project_description', 'clickup', 'slack', 'other')),
  source_title text,
  input_method text not null default 'text'
    check (input_method in ('text', 'file', 'api')),
  file_name text,
  file_path text,
  mime_type text,
  char_count integer,
  source_text text,
  source_preview text,
  external_provider text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_knowledge_sources_project_id on public.project_knowledge_sources (project_id);
create index if not exists idx_project_knowledge_sources_source_type on public.project_knowledge_sources (source_type);
create index if not exists idx_project_knowledge_sources_created_at on public.project_knowledge_sources (created_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_pm_profiles_last_source_id_fkey'
      and conrelid = 'public.project_pm_profiles'::regclass
  ) then
    alter table public.project_pm_profiles
      add constraint project_pm_profiles_last_source_id_fkey
      foreign key (last_source_id) references public.project_knowledge_sources(id) on delete set null;
  end if;
end $$;

create table if not exists public.project_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  source_id uuid references public.project_knowledge_sources(id) on delete cascade,
  chunk_index integer not null default 0,
  content text not null,
  summary text,
  category text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_knowledge_chunks_project_id on public.project_knowledge_chunks (project_id);
create index if not exists idx_project_knowledge_chunks_source_id on public.project_knowledge_chunks (source_id);
create index if not exists idx_project_knowledge_chunks_project_category on public.project_knowledge_chunks (project_id, category);

comment on table public.project_knowledge_chunks is
  'Chunked project memory for future embeddings/chatbot use. Embedding generation is intentionally not implemented in this slice.';

alter table public.project_pm_profiles enable row level security;
alter table public.project_knowledge_sources enable row level security;
alter table public.project_knowledge_chunks enable row level security;

drop policy if exists "project_pm_profiles_team_all" on public.project_pm_profiles;
create policy "project_pm_profiles_team_all"
  on public.project_pm_profiles for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "project_knowledge_sources_team_all" on public.project_knowledge_sources;
create policy "project_knowledge_sources_team_all"
  on public.project_knowledge_sources for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "project_knowledge_chunks_team_all" on public.project_knowledge_chunks;
create policy "project_knowledge_chunks_team_all"
  on public.project_knowledge_chunks for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
