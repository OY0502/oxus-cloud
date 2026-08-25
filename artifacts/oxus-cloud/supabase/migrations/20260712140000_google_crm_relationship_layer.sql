-- =============================================================================
-- OXUS Cloud — Google relationship layer + intelligent CRM extensions
-- Extends clients/contacts in place; adds Google sync, interactions, candidates.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extend clients (companies) with relationship intelligence fields
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists legal_name text,
  add column if not exists primary_domain text,
  add column if not exists alternate_domains text[] not null default '{}'::text[],
  add column if not exists sub_industry text,
  add column if not exists headquarters text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists company_size text,
  add column if not exists business_model text,
  add column if not exists products_services text,
  add column if not exists target_customers text,
  add column if not exists relationship_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists source text,
  add column if not exists first_interaction_at timestamptz,
  add column if not exists last_interaction_at timestamptz,
  add column if not exists next_meeting_at timestamptz,
  add column if not exists interaction_count integer not null default 0,
  add column if not exists relationship_strength text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists field_provenance jsonb not null default '{}'::jsonb,
  add column if not exists locked_fields text[] not null default '{}'::text[],
  add column if not exists enrichment_status text not null default 'not_started',
  add column if not exists enrichment_confidence numeric(4,3),
  add column if not exists last_enriched_at timestamptz,
  add column if not exists enrichment_sources jsonb not null default '[]'::jsonb,
  add column if not exists needs_review boolean not null default false,
  add column if not exists archived_at timestamptz;

create index if not exists idx_clients_primary_domain on public.clients (lower(primary_domain)) where primary_domain is not null;
create index if not exists idx_clients_relationship_owner on public.clients (relationship_owner_id);
create index if not exists idx_clients_last_interaction on public.clients (last_interaction_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Extend contacts (people) with relationship intelligence fields
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists alternate_emails text[] not null default '{}'::text[],
  add column if not exists timezone text,
  add column if not exists language text,
  add column if not exists department text,
  add column if not exists seniority text,
  add column if not exists relationship_type text,
  add column if not exists relationship_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists first_interaction_at timestamptz,
  add column if not exists next_meeting_at timestamptz,
  add column if not exists email_thread_count integer not null default 0,
  add column if not exists meeting_count integer not null default 0,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists field_provenance jsonb not null default '{}'::jsonb,
  add column if not exists locked_fields text[] not null default '{}'::text[],
  add column if not exists decision_maker boolean not null default false,
  add column if not exists technical_contact boolean not null default false,
  add column if not exists billing_contact boolean not null default false,
  add column if not exists archived_at timestamptz;

create index if not exists idx_contacts_email_lower on public.contacts (lower(email)) where email is not null;
create index if not exists idx_contacts_relationship_owner on public.contacts (relationship_owner_id);
create index if not exists idx_contacts_last_contact on public.contacts (last_contact_at desc nulls last);

-- ---------------------------------------------------------------------------
-- person_provider_mappings — external identity links (Google People, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.person_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.contacts(id) on delete cascade,
  provider text not null,
  external_id text not null,
  external_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, external_id),
  unique (person_id, provider, external_id)
);

create index if not exists idx_person_provider_mappings_person on public.person_provider_mappings (person_id);
create index if not exists idx_person_provider_mappings_email on public.person_provider_mappings (lower(external_email)) where external_email is not null;

-- Extend company_provider_mappings provider check to include google
-- (table already exists from CRM migration)

-- ---------------------------------------------------------------------------
-- Per-user Google OAuth connections
-- ---------------------------------------------------------------------------
create table if not exists public.user_google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_account_id text not null,
  google_email text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  granted_scopes text[] not null default '{}'::text[],
  token_expires_at timestamptz,
  status text not null default 'active',
  sources_enabled jsonb not null default '{"contacts":true,"calendar":true,"gmail":false}'::jsonb,
  import_settings jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_google_connections_user_id_unique unique (user_id),
  constraint user_google_connections_status_check check (status in ('active', 'revoked', 'error'))
);

create index if not exists idx_user_google_connections_user on public.user_google_connections (user_id);
create index if not exists idx_user_google_connections_google_account on public.user_google_connections (google_account_id);
create index if not exists idx_user_google_connections_status on public.user_google_connections (status);

drop trigger if exists trg_user_google_connections_updated_at on public.user_google_connections;
create trigger trg_user_google_connections_updated_at
  before update on public.user_google_connections
  for each row execute function public.set_updated_at();

create table if not exists public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redirect_after text,
  requested_scopes text[] not null default '{}'::text[],
  status text not null default 'pending',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_oauth_states_status_check check (status in ('pending', 'used', 'expired', 'failed'))
);

create index if not exists idx_google_oauth_states_state on public.google_oauth_states (state);
create index if not exists idx_google_oauth_states_user on public.google_oauth_states (user_id);

create or replace view public.user_google_connections_safe as
select
  id, user_id, google_account_id, google_email, granted_scopes, token_expires_at,
  status, sources_enabled, import_settings, connected_at, disconnected_at,
  last_successful_sync_at, last_sync_error, metadata, created_at, updated_at
from public.user_google_connections;

-- ---------------------------------------------------------------------------
-- Google sync state per source / resource
-- ---------------------------------------------------------------------------
create table if not exists public.google_sync_states (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  resource_key text not null default 'default',
  sync_token text,
  history_id text,
  initial_sync_completed boolean not null default false,
  last_attempted_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error text,
  next_scheduled_sync_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, source, resource_key)
);

create index if not exists idx_google_sync_states_connection on public.google_sync_states (connection_id);
create index if not exists idx_google_sync_states_next on public.google_sync_states (next_scheduled_sync_at) where next_scheduled_sync_at is not null;

drop trigger if exists trg_google_sync_states_updated_at on public.google_sync_states;
create trigger trg_google_sync_states_updated_at
  before update on public.google_sync_states
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Google import runs
-- ---------------------------------------------------------------------------
create table if not exists public.google_import_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  run_type text not null default 'initial',
  status text not null default 'queued',
  progress_stage text,
  sources text[] not null default '{}'::text[],
  lookback_months integer not null default 12,
  settings jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  trigger_run_id text,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  warnings text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_import_runs_status_check check (status in (
    'queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled'
  ))
);

create index if not exists idx_google_import_runs_connection on public.google_import_runs (connection_id);
create index if not exists idx_google_import_runs_status on public.google_import_runs (status);

drop trigger if exists trg_google_import_runs_updated_at on public.google_import_runs;
create trigger trg_google_import_runs_updated_at
  before update on public.google_import_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Google interactions — normalized relationship evidence
-- ---------------------------------------------------------------------------
create table if not exists public.google_interactions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'google',
  interaction_type text not null,
  external_id text not null,
  external_thread_id text,
  occurred_at timestamptz not null,
  subject text,
  participant_emails text[] not null default '{}'::text[],
  participant_names text[] not null default '{}'::text[],
  organizer_email text,
  attendee_emails text[] not null default '{}'::text[],
  direction text,
  snippet text,
  ai_summary text,
  classification text,
  importance text,
  company_id uuid references public.clients(id) on delete set null,
  person_ids uuid[] not null default '{}'::uuid[],
  project_id uuid references public.projects(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, interaction_type, external_id)
);

create index if not exists idx_google_interactions_owner on public.google_interactions (owner_user_id, occurred_at desc);
create index if not exists idx_google_interactions_company on public.google_interactions (company_id) where company_id is not null;
create index if not exists idx_google_interactions_thread on public.google_interactions (external_thread_id) where external_thread_id is not null;
create index if not exists idx_google_interactions_type on public.google_interactions (interaction_type);

drop trigger if exists trg_google_interactions_updated_at on public.google_interactions;
create trigger trg_google_interactions_updated_at
  before update on public.google_interactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- CRM entity candidates — review queue
-- ---------------------------------------------------------------------------
create table if not exists public.crm_entity_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.user_google_connections(id) on delete set null,
  entity_type text not null,
  status text not null default 'pending',
  display_name text not null,
  email text,
  domain text,
  website text,
  job_title text,
  company_name text,
  suggested_company_type text,
  suggested_relationship_type text,
  confidence numeric(4,3) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  sources text[] not null default '{}'::text[],
  reason text,
  model_version text,
  matched_company_id uuid references public.clients(id) on delete set null,
  matched_person_id uuid references public.contacts(id) on delete set null,
  created_entity_id uuid,
  processed_at timestamptz,
  processed_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_entity_candidates_entity_type_check check (entity_type in ('company', 'person', 'lead')),
  constraint crm_entity_candidates_status_check check (status in ('pending', 'accepted', 'ignored', 'merged', 'deleted'))
);

create index if not exists idx_crm_entity_candidates_owner_status on public.crm_entity_candidates (owner_user_id, status);
create index if not exists idx_crm_entity_candidates_email on public.crm_entity_candidates (lower(email)) where email is not null;
create index if not exists idx_crm_entity_candidates_domain on public.crm_entity_candidates (lower(domain)) where domain is not null;

create unique index if not exists idx_crm_entity_candidates_pending_email
  on public.crm_entity_candidates (owner_user_id, entity_type, lower(email))
  where status = 'pending' and email is not null;

drop trigger if exists trg_crm_entity_candidates_updated_at on public.crm_entity_candidates;
create trigger trg_crm_entity_candidates_updated_at
  before update on public.crm_entity_candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- CRM entity sources — provenance tracking
-- ---------------------------------------------------------------------------
create table if not exists public.crm_entity_sources (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  source_type text not null,
  source_id text,
  source_label text,
  confidence numeric(4,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, source_type, source_id)
);

create index if not exists idx_crm_entity_sources_entity on public.crm_entity_sources (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- CRM entity suppressions — prevent re-import after delete/ignore
-- ---------------------------------------------------------------------------
create table if not exists public.crm_entity_suppressions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  scope text not null default 'workspace',
  suppression_type text not null,
  suppression_key text not null,
  entity_type text,
  entity_id uuid,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (scope, suppression_type, suppression_key)
);

create index if not exists idx_crm_entity_suppressions_key on public.crm_entity_suppressions (suppression_type, suppression_key);
create index if not exists idx_crm_entity_suppressions_owner on public.crm_entity_suppressions (owner_user_id);

-- ---------------------------------------------------------------------------
-- CRM merge history
-- ---------------------------------------------------------------------------
create table if not exists public.crm_merge_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  surviving_id uuid not null,
  merged_id uuid not null,
  merged_snapshot jsonb not null default '{}'::jsonb,
  merged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_merge_history_surviving on public.crm_merge_history (entity_type, surviving_id);

-- ---------------------------------------------------------------------------
-- Extend calendar_events for Google Calendar sync
-- ---------------------------------------------------------------------------
alter table public.calendar_events
  add column if not exists provider text not null default 'manual',
  add column if not exists external_id text,
  add column if not exists external_calendar_id text,
  add column if not exists connection_id uuid references public.user_google_connections(id) on delete set null,
  add column if not exists owner_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists organizer_email text,
  add column if not exists attendee_emails text[] not null default '{}'::text[],
  add column if not exists meeting_url text,
  add column if not exists ai_summary text,
  add column if not exists html_link text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists idx_calendar_events_google_unique
  on public.calendar_events (connection_id, external_calendar_id, external_id)
  where provider = 'google' and external_id is not null;

-- ---------------------------------------------------------------------------
-- Extend activities for CRM interactions
-- ---------------------------------------------------------------------------
alter table public.activities
  add column if not exists company_id uuid references public.clients(id) on delete set null,
  add column if not exists interaction_type text,
  add column if not exists occurred_at timestamptz,
  add column if not exists source text,
  add column if not exists google_interaction_id uuid references public.google_interactions(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_activities_company on public.activities (company_id) where company_id is not null;
create index if not exists idx_activities_occurred on public.activities (occurred_at desc nulls last);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
alter table public.user_google_connections enable row level security;
alter table public.google_oauth_states enable row level security;
alter table public.google_sync_states enable row level security;
alter table public.google_import_runs enable row level security;
alter table public.google_interactions enable row level security;
alter table public.crm_entity_candidates enable row level security;
alter table public.crm_entity_sources enable row level security;
alter table public.crm_entity_suppressions enable row level security;
alter table public.crm_merge_history enable row level security;
alter table public.person_provider_mappings enable row level security;

-- Google connections: own only
drop policy if exists "user_google_connections_select_own" on public.user_google_connections;
create policy "user_google_connections_select_own"
  on public.user_google_connections for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "user_google_connections_delete_own" on public.user_google_connections;
create policy "user_google_connections_delete_own"
  on public.user_google_connections for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "google_oauth_states_select_own" on public.google_oauth_states;
create policy "google_oauth_states_select_own"
  on public.google_oauth_states for select to authenticated
  using (user_id = auth.uid());

-- Sync states: own connection or super admin
drop policy if exists "google_sync_states_select" on public.google_sync_states;
create policy "google_sync_states_select"
  on public.google_sync_states for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin());

-- Import runs: own or super admin
drop policy if exists "google_import_runs_select" on public.google_import_runs;
create policy "google_import_runs_select"
  on public.google_import_runs for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin());

-- Interactions: own or super admin (team can see linked company activities via activities table)
drop policy if exists "google_interactions_select" on public.google_interactions;
create policy "google_interactions_select"
  on public.google_interactions for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin());

-- Candidates: team read, super admin write via edge functions
drop policy if exists "crm_entity_candidates_select" on public.crm_entity_candidates;
create policy "crm_entity_candidates_select"
  on public.crm_entity_candidates for select to authenticated
  using (public.is_team_member());

-- Entity sources: team read
drop policy if exists "crm_entity_sources_select" on public.crm_entity_sources;
create policy "crm_entity_sources_select"
  on public.crm_entity_sources for select to authenticated
  using (public.is_team_member());

-- Suppressions: team read
drop policy if exists "crm_entity_suppressions_select" on public.crm_entity_suppressions;
create policy "crm_entity_suppressions_select"
  on public.crm_entity_suppressions for select to authenticated
  using (public.is_team_member());

-- Merge history: super admin only
drop policy if exists "crm_merge_history_select" on public.crm_merge_history;
create policy "crm_merge_history_select"
  on public.crm_merge_history for select to authenticated
  using (public.is_super_admin());

-- Person provider mappings: team read
drop policy if exists "person_provider_mappings_select" on public.person_provider_mappings;
create policy "person_provider_mappings_select"
  on public.person_provider_mappings for select to authenticated
  using (public.is_team_member());

grant select on public.user_google_connections_safe to authenticated;
