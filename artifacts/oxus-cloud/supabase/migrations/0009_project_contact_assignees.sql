-- Team members on projects reference contacts (people), not app-user profiles.
create table if not exists public.project_contact_assignees (
  project_id uuid not null references public.projects(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, contact_id)
);

create index if not exists idx_project_contact_assignees_contact
  on public.project_contact_assignees (contact_id);

alter table public.project_contact_assignees enable row level security;

drop policy if exists "project_contact_assignees_team_all" on public.project_contact_assignees;
create policy "project_contact_assignees_team_all"
  on public.project_contact_assignees for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
