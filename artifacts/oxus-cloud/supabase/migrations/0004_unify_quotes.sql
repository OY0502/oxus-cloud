-- =============================================================================
-- Unify pipeline "deals" + proposal "quotes" into a single Quotes entity, and
-- add a configurable Technologies list.
--
-- All tables are empty at this point, so the old proposal-style quotes tables
-- are simply dropped and the pipeline `deals` table is repurposed as `quotes`.
-- =============================================================================

-- Retire old proposal-style quotes (replaced by the unified pipeline entity).
drop table if exists public.quote_line_items cascade;
drop table if exists public.quotes cascade;

-- ---------------------------------------------------------------------------
-- technologies — configurable tech list referenced by quotes/projects
-- ---------------------------------------------------------------------------
create table if not exists public.technologies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_technologies_name on public.technologies (name);

drop trigger if exists trg_technologies_updated_at on public.technologies;
create trigger trg_technologies_updated_at
  before update on public.technologies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Repurpose deals as the unified quotes entity.
-- ---------------------------------------------------------------------------
alter table public.deals rename to quotes;

alter table public.quotes
  add column if not exists number              text,
  add column if not exists organization_id     uuid references public.clients(id) on delete set null,
  add column if not exists point_of_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists technology_id        uuid references public.technologies(id) on delete set null,
  add column if not exists assigned_user_id     uuid references public.profiles(id) on delete set null,
  add column if not exists converted_project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_quotes_organization_id on public.quotes (organization_id);
create index if not exists idx_quotes_point_of_contact_id on public.quotes (point_of_contact_id);
create index if not exists idx_quotes_technology_id on public.quotes (technology_id);
create index if not exists idx_quotes_assigned_user_id on public.quotes (assigned_user_id);

-- Constrain project_type to the supported options.
alter table public.quotes drop constraint if exists quotes_project_type_check;
alter table public.quotes
  add constraint quotes_project_type_check
  check (project_type is null or project_type in ('Web App', 'Landing Page', 'IT Consulting', 'Bug Fixing'));

-- Refresh updated_at trigger under the new table name.
drop trigger if exists trg_deals_updated_at on public.quotes;
drop trigger if exists trg_quotes_updated_at on public.quotes;
create trigger trg_quotes_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();
