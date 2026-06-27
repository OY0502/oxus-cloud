-- =============================================================================
-- Projects: draft support + fields carried over from a converted quote.
-- =============================================================================

alter table public.projects
  add column if not exists is_draft            boolean not null default false,
  add column if not exists draft_step          integer not null default 1,
  add column if not exists source_quote_id     uuid references public.quotes(id) on delete set null,
  add column if not exists organization_id     uuid references public.clients(id) on delete set null,
  add column if not exists point_of_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists technology_id        uuid references public.technologies(id) on delete set null,
  add column if not exists project_type         text;

alter table public.projects drop constraint if exists projects_project_type_check;
alter table public.projects
  add constraint projects_project_type_check
  check (project_type is null or project_type in ('Web App', 'Landing Page', 'IT Consulting', 'Bug Fixing'));

create index if not exists idx_projects_source_quote_id on public.projects (source_quote_id);
create index if not exists idx_projects_is_draft on public.projects (is_draft);
