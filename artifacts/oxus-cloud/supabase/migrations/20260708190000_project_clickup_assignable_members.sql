-- Project-scoped ClickUp assignees for task creation (Space/List access only).

create table if not exists public.project_clickup_assignable_members (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  clickup_user_id text not null,
  team_id         text,
  space_id        text,
  folder_id       text,
  list_id         text,
  name            text,
  email           text,
  role            text,
  is_assignable   boolean not null default true,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (project_id, clickup_user_id)
);

create index if not exists idx_project_clickup_assignable_members_project_id
  on public.project_clickup_assignable_members (project_id);

create index if not exists idx_project_clickup_assignable_members_clickup_user_id
  on public.project_clickup_assignable_members (clickup_user_id);

create index if not exists idx_project_clickup_assignable_members_is_assignable
  on public.project_clickup_assignable_members (project_id, is_assignable);

alter table public.project_clickup_assignable_members enable row level security;

drop policy if exists "project_clickup_assignable_members_team_all" on public.project_clickup_assignable_members;
create policy "project_clickup_assignable_members_team_all"
  on public.project_clickup_assignable_members for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.project_clickup_assignable_members is
  'ClickUp members assignable on a project execution Space/List. Distinct from team-wide clickup_members cache.';
