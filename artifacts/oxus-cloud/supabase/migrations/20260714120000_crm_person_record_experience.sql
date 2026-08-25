-- CRM Person record experience: lifecycle, primary project, insights cache, activity indexes

alter table public.contacts
  add column if not exists lifecycle_stage text,
  add column if not exists primary_project_id uuid references public.projects(id) on delete set null;

alter table public.contacts drop constraint if exists contacts_lifecycle_stage_check;
alter table public.contacts
  add constraint contacts_lifecycle_stage_check
  check (lifecycle_stage is null or lifecycle_stage in (
    'subscriber', 'lead', 'marketing_qualified', 'sales_qualified',
    'opportunity', 'customer', 'evangelist', 'other'
  ));

create index if not exists idx_contacts_primary_project on public.contacts (primary_project_id)
  where primary_project_id is not null;
create index if not exists idx_contacts_lifecycle_stage on public.contacts (lifecycle_stage)
  where lifecycle_stage is not null;

-- Person-scoped Google interaction lookups
create index if not exists idx_google_interactions_person_ids
  on public.google_interactions using gin (person_ids);

-- Activity timeline performance for person records
create index if not exists idx_activities_contact_occurred
  on public.activities (contact_id, occurred_at desc nulls last, created_at desc)
  where contact_id is not null;

-- Cached AI relationship insights (optional, generated server-side)
create table if not exists public.crm_record_insights (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('person', 'company')),
  entity_id uuid not null,
  summary jsonb not null default '{}'::jsonb,
  source_types text[] not null default '{}'::text[],
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id) on delete set null,
  model text,
  unique (entity_type, entity_id)
);

create index if not exists idx_crm_record_insights_entity
  on public.crm_record_insights (entity_type, entity_id);

alter table public.crm_record_insights enable row level security;

drop policy if exists crm_record_insights_select on public.crm_record_insights;
create policy crm_record_insights_select
  on public.crm_record_insights for select to authenticated
  using (public.is_super_admin() or public.is_pm_or_super_admin());

drop policy if exists crm_record_insights_write on public.crm_record_insights;
create policy crm_record_insights_write
  on public.crm_record_insights for all to authenticated
  using (public.is_super_admin() or public.is_pm_or_super_admin())
  with check (public.is_super_admin() or public.is_pm_or_super_admin());
