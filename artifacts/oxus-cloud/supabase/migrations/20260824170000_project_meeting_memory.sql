-- Durable operating cadence, structured meeting memory, and explicit PM facts.
--
-- Transcript chunks remain useful for semantic retrieval, but they are not a
-- reliable source of truth for time-bound questions such as "this week" or
-- "the next meeting". These compact records give the project agent a temporal
-- planning layer without adding another database or a background job.

create table if not exists public.project_operating_cadence (
  project_id uuid primary key references public.projects(id) on delete cascade,
  cadence_type text not null default 'weekly'
    check (cadence_type in ('weekly', 'custom')),
  cadence_days smallint not null default 7
    check (cadence_days between 1 and 90),
  meeting_weekday smallint
    check (meeting_weekday is null or meeting_weekday between 0 and 6),
  timezone text not null default 'Europe/Lisbon',
  last_meeting_on date,
  next_meeting_on date,
  source text not null default 'workspace_default'
    check (source in ('workspace_default', 'meeting_memory', 'manual')),
  confidence numeric not null default 0.95
    check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- OXUS projects normally run in one-week client cadences. This is an
-- overridable project setting, not a scheduled job.
insert into public.project_operating_cadence (project_id)
select p.id
from public.projects p
where not exists (
  select 1
  from public.project_operating_cadence c
  where c.project_id = p.id
)
on conflict (project_id) do nothing;

create table if not exists public.project_meeting_memories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null unique references public.project_knowledge_sources(id) on delete cascade,
  agent_run_id uuid references public.project_agent_runs(id) on delete set null,
  title text not null,
  meeting_on date,
  meeting_date_source text not null default 'unknown'
    check (meeting_date_source in ('transcript', 'filename', 'inferred', 'unknown')),
  next_meeting_on date,
  cadence_signal text not null default 'unknown'
    check (cadence_signal in ('weekly', 'other', 'unknown')),
  summary text not null,
  decisions jsonb not null default '[]'::jsonb,
  completed_or_demo jsonb not null default '[]'::jsonb,
  current_week_focus jsonb not null default '[]'::jsonb,
  next_meeting_deliverables jsonb not null default '[]'::jsonb,
  feedback jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  raw_memory jsonb not null default '{}'::jsonb,
  extraction_version smallint not null default 1,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_meeting_memories_project_date_idx
  on public.project_meeting_memories (project_id, meeting_on desc, created_at desc);

create table if not exists public.project_state_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  fact_key text not null,
  subject text not null,
  statement text not null,
  state text,
  effective_on date,
  source_type text not null default 'user_chat'
    check (source_type in ('user_chat', 'meeting', 'manual')),
  source_id uuid references public.project_knowledge_sources(id) on delete set null,
  agent_run_id uuid references public.project_agent_runs(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric not null default 1
    check (confidence between 0 and 1),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, fact_key)
);

create index if not exists project_state_facts_project_updated_idx
  on public.project_state_facts (project_id, updated_at desc);

drop trigger if exists trg_project_operating_cadence_updated_at on public.project_operating_cadence;
create trigger trg_project_operating_cadence_updated_at
  before update on public.project_operating_cadence
  for each row execute function public.set_updated_at();

drop trigger if exists trg_project_meeting_memories_updated_at on public.project_meeting_memories;
create trigger trg_project_meeting_memories_updated_at
  before update on public.project_meeting_memories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_project_state_facts_updated_at on public.project_state_facts;
create trigger trg_project_state_facts_updated_at
  before update on public.project_state_facts
  for each row execute function public.set_updated_at();

alter table public.project_operating_cadence enable row level security;
alter table public.project_meeting_memories enable row level security;
alter table public.project_state_facts enable row level security;

drop policy if exists "Team members can read project cadence" on public.project_operating_cadence;
create policy "Team members can read project cadence"
  on public.project_operating_cadence for select to authenticated
  using (public.is_team_member());

drop policy if exists "Team members can read meeting memory" on public.project_meeting_memories;
create policy "Team members can read meeting memory"
  on public.project_meeting_memories for select to authenticated
  using (public.is_team_member());

drop policy if exists "Team members can read project facts" on public.project_state_facts;
create policy "Team members can read project facts"
  on public.project_state_facts for select to authenticated
  using (public.is_team_member());

comment on table public.project_operating_cadence is
  'Project delivery rhythm used to calculate the current weekly cycle and next review meeting.';
comment on table public.project_meeting_memories is
  'Compact, dated meeting intelligence extracted once per transcript and reused by project chat.';
comment on table public.project_state_facts is
  'Explicit PM assertions and corrections that override older meeting assumptions until updated.';
