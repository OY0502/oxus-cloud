-- ---------------------------------------------------------------------------
-- Figma screens captured per project + screen linkage on AI proposed tasks.
-- A "screen" is a top-level frame in an imported Figma file. We persist its
-- name, an optional AI description, and a rendered thumbnail so the project
-- detail page can show a visual screen gallery and link ClickUp tasks to it.
-- ---------------------------------------------------------------------------

-- Link a proposed task back to the screen (frame name) it belongs to.
alter table public.ai_proposed_tasks
  add column if not exists figma_screen_name text;

create index if not exists idx_ai_proposed_tasks_figma_screen_name
  on public.ai_proposed_tasks (figma_screen_name);

create table if not exists public.project_figma_screens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reference_id uuid references public.project_figma_references(id) on delete cascade,
  file_key text not null,
  node_id text not null,
  name text not null,
  description text,
  page_name text,
  -- Persisted thumbnail in the documents bucket (path); signed URL at read time.
  thumbnail_path text,
  -- Fallback: raw Figma-rendered image URL (expires) when storage upload fails.
  thumbnail_url text,
  figma_url text,
  order_index integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_key, node_id)
);

create index if not exists idx_project_figma_screens_project_id on public.project_figma_screens (project_id);
create index if not exists idx_project_figma_screens_reference_id on public.project_figma_screens (reference_id);
create index if not exists idx_project_figma_screens_file_key on public.project_figma_screens (file_key);

drop trigger if exists trg_project_figma_screens_updated_at on public.project_figma_screens;
create trigger trg_project_figma_screens_updated_at
  before update on public.project_figma_screens
  for each row execute function public.set_updated_at();

alter table public.project_figma_screens enable row level security;

drop policy if exists "project_figma_screens_team_all" on public.project_figma_screens;
create policy "project_figma_screens_team_all"
  on public.project_figma_screens for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
