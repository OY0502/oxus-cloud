-- ---------------------------------------------------------------------------
-- ClickUp hierarchy cache for project agent context
-- ---------------------------------------------------------------------------

create table if not exists public.project_clickup_hierarchy_cache (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  team_id text,
  space_id text,
  folder_id text,
  list_id text,
  node_type text not null
    check (node_type in ('workspace', 'space', 'folder', 'list', 'doc', 'doc_page')),
  external_id text not null,
  parent_external_id text,
  name text not null,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_project_clickup_hierarchy_cache_node
  on public.project_clickup_hierarchy_cache (project_id, node_type, external_id);

create index if not exists idx_project_clickup_hierarchy_cache_project_id
  on public.project_clickup_hierarchy_cache (project_id);

create index if not exists idx_project_clickup_hierarchy_cache_node_type
  on public.project_clickup_hierarchy_cache (project_id, node_type);

create index if not exists idx_project_clickup_hierarchy_cache_last_synced
  on public.project_clickup_hierarchy_cache (project_id, last_synced_at desc);

alter table public.project_clickup_hierarchy_cache enable row level security;

drop policy if exists "project_clickup_hierarchy_cache_team_all" on public.project_clickup_hierarchy_cache;
create policy "project_clickup_hierarchy_cache_team_all"
  on public.project_clickup_hierarchy_cache for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.project_clickup_hierarchy_cache is
  'Cached ClickUp folder/list/doc hierarchy for project agent destination planning.';
