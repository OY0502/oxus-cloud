-- Internal execution notes for ClickUp setup / delivery coordination (not AI memory).

create table if not exists public.project_execution_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  note_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_execution_notes_project_id
  on public.project_execution_notes (project_id, created_at desc);

alter table public.project_execution_notes enable row level security;

drop policy if exists "project_execution_notes_team_all" on public.project_execution_notes;
create policy "project_execution_notes_team_all"
  on public.project_execution_notes for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop trigger if exists trg_project_execution_notes_updated_at on public.project_execution_notes;
create trigger trg_project_execution_notes_updated_at
  before update on public.project_execution_notes
  for each row execute function public.set_updated_at();

comment on table public.project_execution_notes is
  'Human/internal notes about ClickUp execution setup. Not used by AI memory, embeddings, or agent retrieval.';
