-- =============================================================================
-- Follow-up refinements:
--  * Quotes carry the project name/description that seeds a converted project.
--  * Projects gain a description + a single Owner (app user).
--  * Contacts absorb contractor/team fields so the Team directory is sourced
--    from Contacts (type contractor) instead of a separate table.
-- =============================================================================

alter table public.quotes
  add column if not exists project_name        text,
  add column if not exists project_description text;

alter table public.projects
  add column if not exists description text,
  add column if not exists owner_id    uuid references public.profiles(id) on delete set null;

create index if not exists idx_projects_owner_id on public.projects (owner_id);

alter table public.contacts
  add column if not exists job_title       text,
  add column if not exists hourly_rate     numeric,
  add column if not exists availability    text,
  add column if not exists location        text,
  add column if not exists employment_type text,
  add column if not exists stack           text[] not null default '{}';
