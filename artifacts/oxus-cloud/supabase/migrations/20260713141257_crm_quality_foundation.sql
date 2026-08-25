-- CRM quality foundation: normalization fields, confidence routing, logos, preferences

-- Extend company_type options
alter table public.clients drop constraint if exists clients_company_type_check;
alter table public.clients
  add constraint clients_company_type_check
  check (company_type in (
    'internal', 'client', 'prospect', 'partner', 'vendor', 'tool', 'unknown', 'inactive'
  ));

-- Company normalization & quality
alter table public.clients
  add column if not exists display_name text,
  add column if not exists normalized_name text,
  add column if not exists name_confidence numeric(4,3),
  add column if not exists name_source text,
  add column if not exists manually_confirmed boolean not null default false,
  add column if not exists registrable_domain text,
  add column if not exists host_subdomain text,
  add column if not exists normalized_host text,
  add column if not exists data_quality_status text not null default 'accepted',
  add column if not exists suppressed_at timestamptz,
  add column if not exists classification_confidence numeric(4,3),
  add column if not exists classification_evidence jsonb not null default '{}',
  add column if not exists import_confidence numeric(4,3),
  add column if not exists import_confidence_band text,
  add column if not exists last_interaction_type text,
  add column if not exists last_interaction_direction text,
  add column if not exists primary_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists logo_storage_path text,
  add column if not exists logo_source text,
  add column if not exists logo_source_url text,
  add column if not exists logo_confidence numeric(4,3),
  add column if not exists logo_width integer,
  add column if not exists logo_height integer,
  add column if not exists logo_content_hash text,
  add column if not exists logo_resolved_at timestamptz,
  add column if not exists logo_status text not null default 'pending',
  add column if not exists manual_logo_locked boolean not null default false;

alter table public.clients drop constraint if exists clients_data_quality_status_check;
alter table public.clients
  add constraint clients_data_quality_status_check
  check (data_quality_status in ('accepted', 'needs_review', 'suppressed', 'ignored'));

alter table public.clients drop constraint if exists clients_logo_status_check;
alter table public.clients
  add constraint clients_logo_status_check
  check (logo_status in ('pending', 'resolved', 'fallback_favicon', 'initials', 'failed', 'needs_review'));

-- Person quality fields
alter table public.contacts
  add column if not exists display_name text,
  add column if not exists name_confidence numeric(4,3),
  add column if not exists name_source text,
  add column if not exists manually_confirmed boolean not null default false,
  add column if not exists is_role_inbox boolean not null default false,
  add column if not exists role_inbox_label text,
  add column if not exists data_quality_status text not null default 'accepted',
  add column if not exists suppressed_at timestamptz,
  add column if not exists import_confidence numeric(4,3),
  add column if not exists import_confidence_band text,
  add column if not exists last_interaction_at timestamptz,
  add column if not exists last_interaction_type text,
  add column if not exists last_interaction_direction text,
  add column if not exists interaction_count integer not null default 0;

alter table public.contacts drop constraint if exists contacts_data_quality_status_check;
alter table public.contacts
  add constraint contacts_data_quality_status_check
  check (data_quality_status in ('accepted', 'needs_review', 'suppressed', 'ignored'));

-- Expand company_people association labels
alter table public.company_people drop constraint if exists company_people_relationship_type_check;
alter table public.company_people
  add constraint company_people_relationship_type_check
  check (relationship_type in (
    'team_member', 'employee', 'contractor', 'founder', 'advisor',
    'client_contact', 'decision_maker', 'billing_contact', 'technical_contact',
    'former_employee', 'lead', 'partner', 'vendor_contact', 'other'
  ));

-- User CRM preferences (saved views, columns, last tab)
create table if not exists public.crm_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_tab text not null default 'people',
  column_prefs jsonb not null default '{}',
  saved_views jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_user_preferences enable row level security;

drop policy if exists crm_user_preferences_self on public.crm_user_preferences;
create policy crm_user_preferences_self
  on public.crm_user_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Indexes for CRM list performance
create index if not exists idx_clients_registrable_domain on public.clients (lower(registrable_domain));
create index if not exists idx_clients_data_quality on public.clients (data_quality_status);
create index if not exists idx_clients_last_interaction on public.clients (last_interaction_at desc nulls last);
create index if not exists idx_clients_company_type_status on public.clients (company_type, status);
create index if not exists idx_contacts_data_quality on public.contacts (data_quality_status);
create index if not exists idx_contacts_last_interaction on public.contacts (last_interaction_at desc nulls last);
create index if not exists idx_contacts_client_id on public.contacts (client_id);
create index if not exists idx_contacts_email_lower on public.contacts (lower(email));

-- Backfill display_name from existing name fields
update public.clients
set display_name = coalesce(display_name, name),
    normalized_name = coalesce(normalized_name, lower(trim(name))),
    registrable_domain = coalesce(registrable_domain, lower(primary_domain))
where display_name is null or normalized_name is null;

update public.contacts
set display_name = coalesce(display_name, name),
    last_interaction_at = coalesce(last_interaction_at, last_contact_at)
where display_name is null;

-- Imported Google records with weak names should start in review
update public.clients
set data_quality_status = 'needs_review',
    needs_review = true
where source ilike '%google%'
  and data_quality_status = 'accepted'
  and (
    length(trim(name)) <= 4
    or name ~ '^[A-Z][a-z]{1,3}$'
    or registrable_domain is null
  );

update public.contacts
set data_quality_status = 'needs_review'
where source ilike '%google%'
  and data_quality_status = 'accepted'
  and (
    is_role_inbox = true
    or name ~ '^\d{5,}$'
    or lower(name) in ('hello', 'info', 'support', 'sales', 'firecrawl', 'auth', 'bcc')
  );

-- Storage bucket for company logos (private fetch, public read via signed URLs or public bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_logos_public_read on storage.objects;
create policy company_logos_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'company-logos');

drop policy if exists company_logos_service_write on storage.objects;
create policy company_logos_service_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'company-logos' and public.is_super_admin());

drop policy if exists company_logos_service_update on storage.objects;
create policy company_logos_service_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'company-logos' and public.is_super_admin())
  with check (bucket_id = 'company-logos' and public.is_super_admin());
