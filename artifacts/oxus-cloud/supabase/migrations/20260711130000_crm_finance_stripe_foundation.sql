-- =============================================================================
-- OXUS Cloud — CRM / Finance / Stripe foundation
-- Extends clients→companies and contacts→people in place (no duplicate tables).
-- Adds company_people relationships, rates, payouts, Stripe invoice sync.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extend clients (companies)
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists company_type text not null default 'client',
  add column if not exists logo_url text,
  add column if not exists description text,
  add column if not exists status text not null default 'active',
  add column if not exists billing_email text,
  add column if not exists billing_address jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.clients drop constraint if exists clients_company_type_check;
alter table public.clients
  add constraint clients_company_type_check
  check (company_type in ('internal', 'client', 'prospect', 'partner', 'vendor', 'inactive'));

alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'inactive'));

-- ---------------------------------------------------------------------------
-- Extend contacts (people)
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists linkedin_url text,
  add column if not exists avatar_url text,
  add column if not exists person_status text not null default 'active',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

alter table public.contacts drop constraint if exists contacts_person_status_check;
alter table public.contacts
  add constraint contacts_person_status_check
  check (person_status in ('active', 'inactive'));

-- Allow agent type used in frontend
alter table public.contacts drop constraint if exists contacts_type_check;
alter table public.contacts
  add constraint contacts_type_check
  check (type in ('client', 'lead', 'contractor', 'partner', 'vendor', 'agent'));

-- Backfill name parts
update public.contacts
set
  first_name = coalesce(first_name, split_part(name, ' ', 1)),
  last_name = coalesce(
    last_name,
    nullif(trim(substring(name from position(' ' in name) + 1)), '')
  )
where name is not null and name <> '';

-- ---------------------------------------------------------------------------
-- company_people — many-to-many company ↔ person relationships
-- ---------------------------------------------------------------------------
create table if not exists public.company_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.clients(id) on delete cascade,
  person_id uuid not null references public.contacts(id) on delete cascade,
  relationship_type text not null,
  is_primary boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, person_id, relationship_type)
);

create index if not exists idx_company_people_company on public.company_people (company_id);
create index if not exists idx_company_people_person on public.company_people (person_id);
create index if not exists idx_company_people_relationship on public.company_people (relationship_type);

alter table public.company_people drop constraint if exists company_people_relationship_type_check;
alter table public.company_people
  add constraint company_people_relationship_type_check
  check (relationship_type in (
    'employee', 'contractor', 'client_contact', 'decision_maker',
    'billing_contact', 'technical_contact', 'lead', 'partner', 'vendor_contact'
  ));

-- ---------------------------------------------------------------------------
-- team_member_rates — historical compensation
-- ---------------------------------------------------------------------------
create table if not exists public.team_member_rates (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.contacts(id) on delete cascade,
  rate_type text not null,
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_member_rates_person on public.team_member_rates (person_id);
create index if not exists idx_team_member_rates_effective on public.team_member_rates (effective_from, effective_to);

alter table public.team_member_rates drop constraint if exists team_member_rates_rate_type_check;
alter table public.team_member_rates
  add constraint team_member_rates_rate_type_check
  check (rate_type in ('hourly', 'daily', 'monthly', 'fixed_project'));

-- ---------------------------------------------------------------------------
-- payouts — outgoing team payments
-- ---------------------------------------------------------------------------
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.contacts(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  payment_date date,
  period_start date,
  period_end date,
  provider text not null default 'manual',
  external_id text,
  external_url text,
  status text not null default 'pending',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payouts_person on public.payouts (person_id);
create index if not exists idx_payouts_project on public.payouts (project_id);
create index if not exists idx_payouts_payment_date on public.payouts (payment_date);

drop trigger if exists trg_payouts_updated_at on public.payouts;
create trigger trg_payouts_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

alter table public.payouts drop constraint if exists payouts_provider_check;
alter table public.payouts
  add constraint payouts_provider_check
  check (provider in ('manual', 'wise', 'bank_transfer', 'stripe', 'other'));

alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts
  add constraint payouts_status_check
  check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled'));

-- ---------------------------------------------------------------------------
-- company_provider_mappings — Stripe customer etc.
-- ---------------------------------------------------------------------------
create table if not exists public.company_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  external_id text not null,
  billing_email text,
  billing_address jsonb not null default '{}'::jsonb,
  tax_details jsonb not null default '{}'::jsonb,
  preferred_currency text not null default 'EUR',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id),
  unique (company_id, provider)
);

drop trigger if exists trg_company_provider_mappings_updated_at on public.company_provider_mappings;
create trigger trg_company_provider_mappings_updated_at
  before update on public.company_provider_mappings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- stripe_webhook_events — idempotent webhook processing
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  status text not null default 'received',
  payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_stripe_webhook_events_type on public.stripe_webhook_events (event_type);

-- ---------------------------------------------------------------------------
-- stripe_integration_state — safe sync metadata (no secrets)
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_integration_state (
  id uuid primary key default gen_random_uuid(),
  configured boolean not null default false,
  account_id text,
  business_name text,
  last_successful_sync_at timestamptz,
  last_sync_error text,
  webhook_last_received_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.stripe_integration_state (configured)
select false
where not exists (select 1 from public.stripe_integration_state limit 1);

-- ---------------------------------------------------------------------------
-- Extend invoices for provider-aware Stripe sync
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists provider text not null default 'manual',
  add column if not exists external_id text,
  add column if not exists external_customer_id text,
  add column if not exists external_url text,
  add column if not exists hosted_invoice_url text,
  add column if not exists currency text not null default 'EUR',
  add column if not exists subtotal numeric(14,2) not null default 0,
  add column if not exists tax_amount numeric(14,2) not null default 0,
  add column if not exists total numeric(14,2) not null default 0,
  add column if not exists amount_due numeric(14,2) not null default 0,
  add column if not exists issued_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists sync_status text not null default 'pending',
  add column if not exists last_synced_at timestamptz,
  add column if not exists invoice_metadata jsonb not null default '{}'::jsonb,
  add column if not exists company_mapping_status text not null default 'resolved';

-- Backfill invoice totals from legacy columns
update public.invoices
set
  total = coalesce(nullif(total, 0), amount),
  subtotal = coalesce(nullif(subtotal, 0), amount),
  amount_due = greatest(coalesce(nullif(total, 0), amount) - amount_paid, 0),
  issued_at = coalesce(issued_at, issue_date::timestamptz),
  due_at = coalesce(due_at, due_date::timestamptz),
  paid_at = coalesce(paid_at, paid_date::timestamptz)
where true;

create unique index if not exists idx_invoices_provider_external
  on public.invoices (provider, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- Extend invoice_line_items
-- ---------------------------------------------------------------------------
alter table public.invoice_line_items
  add column if not exists quantity numeric(12,2) not null default 1,
  add column if not exists unit_amount numeric(14,2),
  add column if not exists line_total numeric(14,2),
  add column if not exists line_metadata jsonb not null default '{}'::jsonb;

update public.invoice_line_items
set
  unit_amount = coalesce(unit_amount, amount),
  line_total = coalesce(line_total, amount)
where unit_amount is null or line_total is null;

-- ---------------------------------------------------------------------------
-- expenses — future-ready basic structure
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  category text not null default 'other',
  expense_date date not null default current_date,
  provider text not null default 'manual',
  external_id text,
  project_id uuid references public.projects(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_expenses_updated_at on public.expenses;
create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- migration_reconciliation — audit ambiguous backfill records
-- ---------------------------------------------------------------------------
create table if not exists public.crm_migration_reconciliation (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id uuid,
  issue_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Data backfill
-- ---------------------------------------------------------------------------

-- OXUS internal company
insert into public.clients (name, company_type, status, website, description)
select 'OXUS', 'internal', 'active', 'https://oxus.agency', 'Internal OXUS agency entity'
where not exists (
  select 1 from public.clients where company_type = 'internal' and lower(name) = 'oxus'
);

-- All existing clients default to company_type client (already default)
update public.clients set company_type = 'client' where company_type is null;

-- company_people from contacts.client_id
insert into public.company_people (company_id, person_id, relationship_type, is_primary)
select
  c.client_id,
  c.id,
  case c.type
    when 'lead' then 'lead'
    when 'contractor' then 'contractor'
    when 'partner' then 'partner'
    when 'vendor' then 'vendor_contact'
    when 'agent' then 'technical_contact'
    else 'client_contact'
  end,
  false
from public.contacts c
where c.client_id is not null
on conflict (company_id, person_id, relationship_type) do nothing;

-- Link contractors/employees to OXUS internal company
insert into public.company_people (company_id, person_id, relationship_type, is_primary)
select
  ox.id,
  c.id,
  case
    when c.employment_type = 'employee' then 'employee'
    else 'contractor'
  end,
  false
from public.contacts c
cross join public.clients ox
where c.type in ('contractor', 'agent')
  and ox.company_type = 'internal'
  and lower(ox.name) = 'oxus'
on conflict (company_id, person_id, relationship_type) do nothing;

-- Merge team_members into contacts by email (dedupe)
do $$
declare
  tm record;
  existing_id uuid;
  oxus_id uuid;
begin
  select id into oxus_id from public.clients where company_type = 'internal' and lower(name) = 'oxus' limit 1;

  for tm in select * from public.team_members loop
    existing_id := null;
    if tm.email is not null then
      select id into existing_id from public.contacts where lower(email) = lower(tm.email) limit 1;
    end if;

    if existing_id is null then
      insert into public.contacts (
        name, type, email, job_title, avatar_url, location,
        employment_type, availability, hourly_rate, stack, profile_id, person_status
      ) values (
        tm.name,
        case when tm.employment_type = 'employee' then 'agent' else 'contractor' end,
        tm.email,
        tm.job_title,
        tm.avatar_url,
        tm.location,
        tm.employment_type,
        tm.availability,
        tm.hourly_rate,
        tm.stack,
        tm.profile_id,
        case when tm.status = 'inactive' then 'inactive' else 'active' end
      )
      returning id into existing_id;
    else
      insert into public.crm_migration_reconciliation (source_table, source_id, issue_type, details)
      values ('team_members', tm.id, 'email_deduped', jsonb_build_object('contact_id', existing_id, 'email', tm.email));
    end if;

    if oxus_id is not null then
      insert into public.company_people (company_id, person_id, relationship_type)
      values (
        oxus_id,
        existing_id,
        case when tm.employment_type = 'employee' then 'employee' else 'contractor' end
      )
      on conflict (company_id, person_id, relationship_type) do nothing;
    end if;

    if tm.hourly_rate is not null and tm.hourly_rate > 0 then
      insert into public.team_member_rates (person_id, rate_type, amount, effective_from, notes)
      select existing_id, 'hourly', tm.hourly_rate, coalesce(tm.created_at::date, current_date), 'Migrated from team_members'
      where not exists (
        select 1 from public.team_member_rates r
        where r.person_id = existing_id and r.amount = tm.hourly_rate and r.rate_type = 'hourly'
      );
    end if;
  end loop;
end $$;

-- Rates from contacts.hourly_rate
insert into public.team_member_rates (person_id, rate_type, amount, effective_from, notes)
select c.id, 'hourly', c.hourly_rate, coalesce(c.created_at::date, current_date), 'Migrated from contacts.hourly_rate'
from public.contacts c
where c.hourly_rate is not null and c.hourly_rate > 0
  and not exists (
    select 1 from public.team_member_rates r where r.person_id = c.id
  );

-- Email duplicates in contacts
insert into public.crm_migration_reconciliation (source_table, source_id, issue_type, details)
select 'contacts', c1.id, 'duplicate_email',
  jsonb_build_object('email', c1.email, 'duplicate_of', c2.id)
from public.contacts c1
join public.contacts c2 on lower(c1.email) = lower(c2.email) and c1.id < c2.id
where c1.email is not null and c1.email <> '';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.company_people enable row level security;
alter table public.team_member_rates enable row level security;
alter table public.payouts enable row level security;
alter table public.company_provider_mappings enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_integration_state enable row level security;
alter table public.expenses enable row level security;
alter table public.crm_migration_reconciliation enable row level security;

-- company_people: team read, super_admin write
drop policy if exists company_people_select on public.company_people;
create policy company_people_select on public.company_people
  for select to authenticated using (public.is_team_member());

drop policy if exists company_people_write on public.company_people;
create policy company_people_write on public.company_people
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Financial tables: super_admin only
drop policy if exists team_member_rates_all on public.team_member_rates;
create policy team_member_rates_all on public.team_member_rates
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists payouts_all on public.payouts;
create policy payouts_all on public.payouts
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists company_provider_mappings_all on public.company_provider_mappings;
create policy company_provider_mappings_all on public.company_provider_mappings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Stripe internal tables: no frontend access
drop policy if exists stripe_webhook_events_deny on public.stripe_webhook_events;
create policy stripe_webhook_events_deny on public.stripe_webhook_events
  for all to authenticated using (false);

drop policy if exists stripe_integration_state_select on public.stripe_integration_state;
create policy stripe_integration_state_select on public.stripe_integration_state
  for select to authenticated using (public.is_super_admin());

drop policy if exists stripe_integration_state_write on public.stripe_integration_state;
create policy stripe_integration_state_write on public.stripe_integration_state
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists crm_migration_reconciliation_select on public.crm_migration_reconciliation;
create policy crm_migration_reconciliation_select on public.crm_migration_reconciliation
  for select to authenticated using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Convenience views (read-only aliases)
-- ---------------------------------------------------------------------------
create or replace view public.companies as
  select * from public.clients;

create or replace view public.people as
  select
    id,
    coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), name) as full_name,
    first_name,
    last_name,
    name,
    email,
    phone,
    job_title,
    linkedin_url,
    avatar_url,
    person_status as status,
    metadata,
    created_at,
    updated_at
  from public.contacts;
