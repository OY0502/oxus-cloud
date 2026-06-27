-- =============================================================================
-- Agency OS — core schema
-- Internal operating system for a web-development agency.
--
-- Design principles
--   * Relational: companies/people/work/money are normalised and linked by FK.
--   * Scalable: surrogate uuid PKs, btree indexes on every FK + hot filter col.
--   * Efficient: status fields are short text + CHECK (cheap, index-friendly),
--     derived numbers come from views instead of being denormalised.
--   * Protected: RLS is ON for every table. Only authenticated team members
--     (a row in public.profiles) can touch business data; anon gets nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — app users (the agency staff who log in)
-- One row per auth.users row, created automatically on sign-up.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  avatar_url  text,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Mirror new auth users into profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Runs only as the auth.users trigger above — never as a public RPC.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Backfill profiles for any users that already exist.
insert into public.profiles (id, full_name, email, avatar_url)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  u.email,
  u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- True when the current request comes from a signed-in team member.
-- SECURITY DEFINER + fixed search_path so it can be reused inside policies
-- without recursive RLS evaluation on profiles. Defined after profiles so the
-- referenced relation exists at function-creation time.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid()
  );
$$;

-- Referenced by RLS policies (authenticated keeps EXECUTE); not for anon RPC.
revoke execute on function public.is_team_member() from anon, public;

-- ---------------------------------------------------------------------------
-- clients — companies the agency works with / sells to
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  website     text,
  industry    text,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_clients_name on public.clients (name);
create index if not exists idx_clients_created_by on public.clients (created_by);

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- contacts — people (clients, leads, partners, vendors, contractors)
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  type                  text not null default 'lead'
                          check (type in ('client', 'lead', 'contractor', 'partner', 'vendor')),
  company               text,
  client_id             uuid references public.clients(id) on delete set null,
  email                 text,
  phone                 text,
  relationship_strength text not null default 'new'
                          check (relationship_strength in ('strong', 'medium', 'weak', 'new')),
  source                text,
  notes                 text,
  last_contact_at       timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_contacts_client_id on public.contacts (client_id);
create index if not exists idx_contacts_type on public.contacts (type);
create index if not exists idx_contacts_created_by on public.contacts (created_by);

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- team_members — the agency roster (employees + contractors)
-- Distinct from profiles: a roster entry need not have an app login.
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  job_title       text,
  email           text,
  avatar_url      text,
  location        text,
  employment_type text not null default 'employee'
                    check (employment_type in ('employee', 'contractor')),
  status          text not null default 'active'
                    check (status in ('active', 'inactive')),
  availability    text not null default 'full'
                    check (availability in ('full', 'partial', 'busy', 'unavailable')),
  hourly_rate     numeric(10,2),
  stack           text[] not null default '{}',
  unpaid_invoices integer not null default 0 check (unpaid_invoices >= 0),
  notes           text,
  profile_id      uuid references public.profiles(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_team_members_status on public.team_members (status);
create index if not exists idx_team_members_created_by on public.team_members (created_by);

drop trigger if exists trg_team_members_updated_at on public.team_members;
create trigger trg_team_members_updated_at
  before update on public.team_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- deals — pipeline cards (kanban)
-- ---------------------------------------------------------------------------
create table if not exists public.deals (
  id            uuid primary key default gen_random_uuid(),
  company       text not null,
  client_id     uuid references public.clients(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  contact_name  text,
  project_type  text,
  budget        numeric(12,2) not null default 0,
  stage         text not null default 'new-lead'
                  check (stage in ('new-lead', 'scoping', 'proposal', 'won', 'archived')),
  urgency       text not null default 'normal'
                  check (urgency in ('low', 'normal', 'high')),
  next_action   text,
  tags          text[] not null default '{}',
  owner_id      uuid references public.team_members(id) on delete set null,
  position      integer not null default 0,        -- ordering within a stage
  stage_entered_at timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_deals_stage on public.deals (stage);
create index if not exists idx_deals_client_id on public.deals (client_id);
create index if not exists idx_deals_owner_id on public.deals (owner_id);

drop trigger if exists trg_deals_updated_at on public.deals;
create trigger trg_deals_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects — delivery work
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  client_id    uuid references public.clients(id) on delete set null,
  client_name  text,
  status       text not null default 'planning'
                 check (status in ('planning', 'in-progress', 'on-hold', 'completed')),
  priority     text not null default 'medium'
                 check (priority in ('low', 'medium', 'high')),
  health       text not null default 'on-track'
                 check (health in ('on-track', 'at-risk', 'off-track')),
  risk         text not null default 'low'
                 check (risk in ('none', 'low', 'medium', 'high')),
  progress     integer not null default 0 check (progress between 0 and 100),
  budget       numeric(12,2) not null default 0,
  start_date   date,
  deadline     date,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_projects_client_id on public.projects (client_id);
create index if not exists idx_projects_status on public.projects (status);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- projects <-> team_members (many-to-many)
create table if not exists public.project_assignees (
  project_id     uuid not null references public.projects(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (project_id, team_member_id)
);
create index if not exists idx_project_assignees_member on public.project_assignees (team_member_id);

-- ---------------------------------------------------------------------------
-- quotes — proposals
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  number          text not null,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  project         text,
  amount          numeric(12,2) not null default 0,
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'accepted', 'declined')),
  conversion      integer not null default 0 check (conversion between 0 and 100),
  owner_id        uuid references public.team_members(id) on delete set null,
  owner_name      text,
  issue_date      date not null default current_date,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_quotes_client_id on public.quotes (client_id);
create index if not exists idx_quotes_status on public.quotes (status);

drop trigger if exists trg_quotes_updated_at on public.quotes;
create trigger trg_quotes_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

create table if not exists public.quote_line_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  description text not null,
  amount      numeric(12,2) not null default 0,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_quote_line_items_quote on public.quote_line_items (quote_id);

-- ---------------------------------------------------------------------------
-- invoices — billing lifecycle
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  number          text not null,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  project_id      uuid references public.projects(id) on delete set null,
  project         text,
  amount          numeric(12,2) not null default 0,
  amount_paid     numeric(12,2) not null default 0,
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'viewed', 'partial', 'overdue', 'paid')),
  issue_date      date not null default current_date,
  due_date        date,
  paid_date       date,
  payment_method  text,
  owner_id        uuid references public.team_members(id) on delete set null,
  owner_name      text,
  last_reminder_at timestamptz,
  stripe_status   text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_invoices_client_id on public.invoices (client_id);
create index if not exists idx_invoices_project_id on public.invoices (project_id);
create index if not exists idx_invoices_status on public.invoices (status);
create index if not exists idx_invoices_due_date on public.invoices (due_date);

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create table if not exists public.invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  amount      numeric(12,2) not null default 0,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_invoice_line_items_invoice on public.invoice_line_items (invoice_id);

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  event_date  date not null,
  start_time  text,
  end_time    text,
  type        text not null default 'meeting'
                check (type in ('meeting', 'design', 'internal', 'milestone')),
  location    text,
  color       text,
  project_id  uuid references public.projects(id) on delete set null,
  client_id   uuid references public.clients(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_calendar_events_date on public.calendar_events (event_date);

drop trigger if exists trg_calendar_events_updated_at on public.calendar_events;
create trigger trg_calendar_events_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

create table if not exists public.event_attendees (
  event_id       uuid not null references public.calendar_events(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  primary key (event_id, team_member_id)
);
create index if not exists idx_event_attendees_member on public.event_attendees (team_member_id);

-- ---------------------------------------------------------------------------
-- transactions — finance ledger (cash in / out)
-- Monthly cash-flow and category breakdowns are derived from this table.
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  occurred_on date not null default current_date,
  description text not null,
  amount      numeric(12,2) not null,            -- positive = income, negative = expense
  category    text not null default 'Other',
  type        text not null default 'expense'
                check (type in ('income', 'expense')),
  client_id   uuid references public.clients(id) on delete set null,
  invoice_id  uuid references public.invoices(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_transactions_occurred_on on public.transactions (occurred_on);
create index if not exists idx_transactions_type on public.transactions (type);

drop trigger if exists trg_transactions_updated_at on public.transactions;
create trigger trg_transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities — audit / activity feed across the workspace
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'default'
                check (kind in ('success', 'info', 'warning', 'default')),
  title       text not null,
  description text,
  entity_type text,        -- e.g. 'invoice', 'quote', 'deal', 'project', 'contact'
  entity_id   uuid,
  contact_id  uuid references public.contacts(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activities_created_at on public.activities (created_at desc);
create index if not exists idx_activities_contact_id on public.activities (contact_id);

-- ---------------------------------------------------------------------------
-- Derived view: team member stats (active project count)
-- ---------------------------------------------------------------------------
create or replace view public.team_member_stats
with (security_invoker = true) as
select
  tm.id as team_member_id,
  count(distinct pa.project_id) filter (
    where p.status in ('planning', 'in-progress', 'on-hold')
  )::int as active_projects
from public.team_members tm
left join public.project_assignees pa on pa.team_member_id = tm.id
left join public.projects p on p.id = pa.project_id
group by tm.id;
