-- ---------------------------------------------------------------------------
-- AI project briefs and proposed tasks
-- ---------------------------------------------------------------------------

create table if not exists public.ai_project_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'zoom_transcript', 'project_description', 'other')),
  source_text text not null,
  summary text,
  goals text[] default '{}',
  scope_in text[] default '{}',
  scope_out text[] default '{}',
  risks text[] default '{}',
  open_questions text[] default '{}',
  qa_notes text[] default '{}',
  raw_response jsonb,
  model text,
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed')),
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_project_briefs_project_id on public.ai_project_briefs (project_id);
create index if not exists idx_ai_project_briefs_created_at on public.ai_project_briefs (created_at);

drop trigger if exists trg_ai_project_briefs_updated_at on public.ai_project_briefs;
create trigger trg_ai_project_briefs_updated_at
  before update on public.ai_project_briefs
  for each row execute function public.set_updated_at();

create table if not exists public.ai_proposed_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  brief_id uuid references public.ai_project_briefs(id) on delete cascade,
  title text not null,
  description text,
  acceptance_criteria text[] default '{}',
  qa_scenarios jsonb default '[]'::jsonb,
  priority text default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  confidence numeric,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  raw_item jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_proposed_tasks_project_id on public.ai_proposed_tasks (project_id);
create index if not exists idx_ai_proposed_tasks_brief_id on public.ai_proposed_tasks (brief_id);
create index if not exists idx_ai_proposed_tasks_status on public.ai_proposed_tasks (status);

drop trigger if exists trg_ai_proposed_tasks_updated_at on public.ai_proposed_tasks;
create trigger trg_ai_proposed_tasks_updated_at
  before update on public.ai_proposed_tasks
  for each row execute function public.set_updated_at();

alter table public.ai_project_briefs enable row level security;
alter table public.ai_proposed_tasks enable row level security;

drop policy if exists "ai_project_briefs_team_all" on public.ai_project_briefs;
create policy "ai_project_briefs_team_all"
  on public.ai_project_briefs for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "ai_proposed_tasks_team_all" on public.ai_proposed_tasks;
create policy "ai_proposed_tasks_team_all"
  on public.ai_proposed_tasks for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
