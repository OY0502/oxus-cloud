-- CRM reconciliation enhancements: visibility, provenance aggregation, audit trail

alter table public.clients
  add column if not exists visibility_state text not null default 'active',
  add column if not exists quality_reason text,
  add column if not exists aggregated_sources text[] not null default '{}',
  add column if not exists first_interaction_at timestamptz,
  add column if not exists two_way_thread_count integer not null default 0,
  add column if not exists soft_deleted_at timestamptz,
  add column if not exists merged_into_id uuid references public.clients(id) on delete set null;

alter table public.clients drop constraint if exists clients_visibility_state_check;
alter table public.clients
  add constraint clients_visibility_state_check
  check (visibility_state in ('active', 'needs_review', 'suppressed', 'inactive', 'merged'));

alter table public.contacts
  add column if not exists visibility_state text not null default 'active',
  add column if not exists quality_reason text,
  add column if not exists aggregated_sources text[] not null default '{}',
  add column if not exists is_automated_sender boolean not null default false,
  add column if not exists first_interaction_at timestamptz,
  add column if not exists two_way_thread_count integer not null default 0,
  add column if not exists soft_deleted_at timestamptz,
  add column if not exists merged_into_id uuid references public.contacts(id) on delete set null;

alter table public.contacts drop constraint if exists contacts_visibility_state_check;
alter table public.contacts
  add constraint contacts_visibility_state_check
  check (visibility_state in ('active', 'needs_review', 'suppressed', 'inactive', 'merged'));

create index if not exists idx_clients_visibility on public.clients (visibility_state);
create index if not exists idx_contacts_visibility on public.contacts (visibility_state);
create index if not exists idx_clients_soft_deleted on public.clients (soft_deleted_at) where soft_deleted_at is not null;
create index if not exists idx_contacts_soft_deleted on public.contacts (soft_deleted_at) where soft_deleted_at is not null;

-- Reconciliation run history (admin diagnostics)
create table if not exists public.crm_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  dry_run boolean not null default false,
  triggered_by uuid references auth.users(id) on delete set null,
  status text not null default 'running',
  before_stats jsonb not null default '{}',
  after_stats jsonb not null default '{}',
  report jsonb not null default '{}',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint crm_reconciliation_runs_status_check
    check (status in ('running', 'completed', 'failed'))
);

create index if not exists idx_crm_reconciliation_runs_started on public.crm_reconciliation_runs (started_at desc);

alter table public.crm_reconciliation_runs enable row level security;

drop policy if exists crm_reconciliation_runs_super_admin on public.crm_reconciliation_runs;
create policy crm_reconciliation_runs_super_admin
  on public.crm_reconciliation_runs for select
  to authenticated
  using (public.is_super_admin());

-- Map legacy quality status to visibility_state
update public.clients
set visibility_state = case data_quality_status
  when 'needs_review' then 'needs_review'
  when 'suppressed' then 'suppressed'
  when 'ignored' then 'suppressed'
  else 'active'
end
where visibility_state = 'active' and data_quality_status is not null;

update public.contacts
set visibility_state = case data_quality_status
  when 'needs_review' then 'needs_review'
  when 'suppressed' then 'suppressed'
  when 'ignored' then 'suppressed'
  else 'active'
end
where visibility_state = 'active' and data_quality_status is not null;
