-- =============================================================================
-- OXUS Cloud — CRM identity resolution v2 (source evidence + identity graph)
-- Reuses canonical clients/contacts/company_people; adds evidence + resolver runs.
-- =============================================================================

-- Resolver version on Google connections (v2 = evidence-first pipeline)
alter table public.user_google_connections
  add column if not exists crm_resolver_version integer not null default 1,
  add column if not exists crm_migrated_at timestamptz,
  add column if not exists crm_migration_run_id uuid;

alter table public.user_google_connections
  drop constraint if exists user_google_connections_crm_resolver_version_check;
alter table public.user_google_connections
  add constraint user_google_connections_crm_resolver_version_check
  check (crm_resolver_version in (1, 2));

-- Canonical entity resolver metadata
alter table public.contacts
  add column if not exists canonical_person_key text,
  add column if not exists identity_confidence numeric(4,3),
  add column if not exists identity_quality_reason text,
  add column if not exists primary_email text,
  add column if not exists photo_storage_path text,
  add column if not exists photo_source text,
  add column if not exists photo_status text not null default 'not_requested',
  add column if not exists crm_resolver_version integer not null default 1;

alter table public.contacts
  drop constraint if exists contacts_photo_status_check;
alter table public.contacts
  add constraint contacts_photo_status_check
  check (photo_status in ('not_requested', 'queued', 'resolving', 'resolved', 'fallback', 'failed'));

alter table public.clients
  add column if not exists canonical_company_key text,
  add column if not exists identity_confidence numeric(4,3),
  add column if not exists identity_quality_reason text,
  add column if not exists crm_resolver_version integer not null default 1;

create index if not exists idx_contacts_canonical_person_key on public.contacts (canonical_person_key) where canonical_person_key is not null;
create index if not exists idx_contacts_primary_email on public.contacts (lower(primary_email)) where primary_email is not null;
create index if not exists idx_contacts_crm_resolver_version on public.contacts (crm_resolver_version);
create index if not exists idx_clients_canonical_company_key on public.clients (canonical_company_key) where canonical_company_key is not null;
create index if not exists idx_clients_crm_resolver_version on public.clients (crm_resolver_version);

-- ---------------------------------------------------------------------------
-- google_calendar_attendees — attendee-level Calendar evidence
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_attendees (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.user_google_connections(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  calendar_event_id uuid references public.calendar_events(id) on delete cascade,
  external_event_id text not null,
  external_calendar_id text not null,
  attendee_email text not null,
  normalized_email text not null,
  display_name text,
  response_status text,
  is_organizer boolean not null default false,
  is_resource boolean not null default false,
  is_self boolean not null default false,
  event_start_at timestamptz,
  event_status text not null default 'confirmed',
  registrable_domain text,
  source_confidence numeric(4,3) not null default 0.85,
  exclusion_reason text,
  processing_status text not null default 'pending',
  canonical_person_id uuid references public.contacts(id) on delete set null,
  raw_metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_calendar_id, external_event_id, normalized_email)
);

create index if not exists idx_google_calendar_attendees_connection on public.google_calendar_attendees (connection_id);
create index if not exists idx_google_calendar_attendees_email on public.google_calendar_attendees (lower(normalized_email));
create index if not exists idx_google_calendar_attendees_person on public.google_calendar_attendees (canonical_person_id) where canonical_person_id is not null;
create index if not exists idx_google_calendar_attendees_status on public.google_calendar_attendees (processing_status);

drop trigger if exists trg_google_calendar_attendees_updated_at on public.google_calendar_attendees;
create trigger trg_google_calendar_attendees_updated_at
  before update on public.google_calendar_attendees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_source_people — normalized person evidence (immutable provider facts)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_source_people (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.user_google_connections(id) on delete set null,
  provider text not null,
  source_type text not null,
  external_id text not null,
  normalized_email text,
  display_name text,
  structured_first_name text,
  structured_last_name text,
  organization_name text,
  job_title text,
  phone text,
  photo_url text,
  original_domain text,
  registrable_domain text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_confidence numeric(4,3) not null default 0.5,
  raw_metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  canonical_person_id uuid references public.contacts(id) on delete set null,
  processing_status text not null default 'pending',
  migration_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, provider, source_type, external_id)
);

create index if not exists idx_crm_source_people_owner on public.crm_source_people (owner_user_id);
create index if not exists idx_crm_source_people_email on public.crm_source_people (lower(normalized_email)) where normalized_email is not null;
create index if not exists idx_crm_source_people_person on public.crm_source_people (canonical_person_id) where canonical_person_id is not null;
create index if not exists idx_crm_source_people_status on public.crm_source_people (processing_status);

drop trigger if exists trg_crm_source_people_updated_at on public.crm_source_people;
create trigger trg_crm_source_people_updated_at
  before update on public.crm_source_people
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_source_companies — normalized company evidence
-- ---------------------------------------------------------------------------
create table if not exists public.crm_source_companies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  source_type text not null,
  external_id text not null,
  organization_name text,
  website_url text,
  original_domain text,
  registrable_domain text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_confidence numeric(4,3) not null default 0.5,
  raw_metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  canonical_company_id uuid references public.clients(id) on delete set null,
  processing_status text not null default 'pending',
  migration_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, provider, source_type, external_id)
);

create index if not exists idx_crm_source_companies_owner on public.crm_source_companies (owner_user_id);
create index if not exists idx_crm_source_companies_domain on public.crm_source_companies (lower(registrable_domain)) where registrable_domain is not null;
create index if not exists idx_crm_source_companies_company on public.crm_source_companies (canonical_company_id) where canonical_company_id is not null;

drop trigger if exists trg_crm_source_companies_updated_at on public.crm_source_companies;
create trigger trg_crm_source_companies_updated_at
  before update on public.crm_source_companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_source_interactions — normalized activity evidence
-- ---------------------------------------------------------------------------
create table if not exists public.crm_source_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.user_google_connections(id) on delete set null,
  provider text not null,
  source_type text not null,
  external_id text not null,
  person_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  activity_type text not null,
  occurred_at timestamptz not null,
  direction text,
  title text,
  safe_summary text,
  is_automated boolean not null default false,
  is_meaningful boolean not null default true,
  source_person_id uuid references public.crm_source_people(id) on delete set null,
  raw_metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  activity_id uuid references public.activities(id) on delete set null,
  processing_status text not null default 'pending',
  migration_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, provider, source_type, external_id)
);

create index if not exists idx_crm_source_interactions_owner on public.crm_source_interactions (owner_user_id);
create index if not exists idx_crm_source_interactions_person on public.crm_source_interactions (person_id);
create index if not exists idx_crm_source_interactions_occurred on public.crm_source_interactions (occurred_at desc);

drop trigger if exists trg_crm_source_interactions_updated_at on public.crm_source_interactions;
create trigger trg_crm_source_interactions_updated_at
  before update on public.crm_source_interactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- person_identities / company_identities — explicit identity graph
-- ---------------------------------------------------------------------------
create table if not exists public.person_identities (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.contacts(id) on delete cascade,
  identity_type text not null,
  normalized_value text not null,
  source_type text not null,
  source_id text,
  confidence numeric(4,3) not null default 0.5,
  verified boolean not null default false,
  crm_resolver_version integer not null default 2,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_user_id, identity_type, normalized_value)
);

create index if not exists idx_person_identities_person on public.person_identities (person_id);
create index if not exists idx_person_identities_value on public.person_identities (identity_type, lower(normalized_value));

create table if not exists public.company_identities (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.clients(id) on delete cascade,
  identity_type text not null,
  normalized_value text not null,
  source_type text not null,
  source_id text,
  confidence numeric(4,3) not null default 0.5,
  verified boolean not null default false,
  crm_resolver_version integer not null default 2,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_user_id, identity_type, normalized_value)
);

create index if not exists idx_company_identities_company on public.company_identities (company_id);
create index if not exists idx_company_identities_value on public.company_identities (identity_type, lower(normalized_value));

-- ---------------------------------------------------------------------------
-- crm_resolver_runs — staged resumable pipeline
-- ---------------------------------------------------------------------------
create table if not exists public.crm_resolver_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.user_google_connections(id) on delete set null,
  run_type text not null default 'incremental',
  crm_resolver_version integer not null default 2,
  current_stage text not null default 'sync_source_evidence',
  stage_checkpoint jsonb not null default '{}'::jsonb,
  status text not null default 'running',
  processed_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  error_message text,
  heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint crm_resolver_runs_status_check check (status in ('running', 'completed', 'failed', 'paused')),
  constraint crm_resolver_runs_stage_check check (current_stage in (
    'sync_source_evidence', 'normalize_source_identities', 'resolve_people', 'resolve_companies',
    'resolve_associations', 'publish_canonical_entities', 'rebuild_activities',
    'classify_relationships', 'resolve_photos_and_logos', 'queue_uncertain_records', 'completed'
  ))
);

create index if not exists idx_crm_resolver_runs_owner on public.crm_resolver_runs (owner_user_id, started_at desc);
create unique index if not exists idx_crm_resolver_runs_active
  on public.crm_resolver_runs (connection_id)
  where status = 'running' and connection_id is not null;

-- ---------------------------------------------------------------------------
-- crm_migration_audit — compact pre/post migration record (not full row copies)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_migration_audit (
  id uuid primary key default gen_random_uuid(),
  migration_run_id uuid not null,
  entity_type text not null check (entity_type in ('person', 'company')),
  canonical_record_id uuid not null,
  old_visibility text,
  old_relationship_type text,
  old_primary_association_id uuid,
  old_display_name text,
  migration_action text not null,
  new_canonical_record_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_migration_audit_run on public.crm_migration_audit (migration_run_id);

-- Person photos storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'person-photos',
  'person-photos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists person_photos_public_read on storage.objects;
create policy person_photos_public_read
  on storage.objects for select to public
  using (bucket_id = 'person-photos');

-- RLS
alter table public.google_calendar_attendees enable row level security;
alter table public.crm_source_people enable row level security;
alter table public.crm_source_companies enable row level security;
alter table public.crm_source_interactions enable row level security;
alter table public.person_identities enable row level security;
alter table public.company_identities enable row level security;
alter table public.crm_resolver_runs enable row level security;
alter table public.crm_migration_audit enable row level security;

drop policy if exists google_calendar_attendees_team on public.google_calendar_attendees;
create policy google_calendar_attendees_team on public.google_calendar_attendees for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin() or public.is_team_member());

drop policy if exists crm_source_people_team on public.crm_source_people;
create policy crm_source_people_team on public.crm_source_people for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin() or public.is_team_member());

drop policy if exists crm_source_companies_team on public.crm_source_companies;
create policy crm_source_companies_team on public.crm_source_companies for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin() or public.is_team_member());

drop policy if exists crm_source_interactions_team on public.crm_source_interactions;
create policy crm_source_interactions_team on public.crm_source_interactions for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin() or public.is_team_member());

drop policy if exists person_identities_team on public.person_identities;
create policy person_identities_team on public.person_identities for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin() or public.is_team_member());

drop policy if exists company_identities_team on public.company_identities;
create policy company_identities_team on public.company_identities for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin() or public.is_team_member());

drop policy if exists crm_resolver_runs_team on public.crm_resolver_runs;
create policy crm_resolver_runs_team on public.crm_resolver_runs for select to authenticated
  using (owner_user_id = auth.uid() or public.is_super_admin());

drop policy if exists crm_migration_audit_super on public.crm_migration_audit;
create policy crm_migration_audit_super on public.crm_migration_audit for select to authenticated
  using (public.is_super_admin());

comment on table public.crm_source_people is 'DEPRECATED after v2 cutover for legacy writers — canonical evidence for person identities.';
comment on table public.google_interactions is 'Legacy interaction evidence; v2 resolver reads but new canonical writes go through crm_source_* + resolver pipeline.';
