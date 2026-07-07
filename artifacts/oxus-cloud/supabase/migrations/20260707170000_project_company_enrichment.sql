-- ---------------------------------------------------------------------------
-- Firecrawl-based company/project enrichment
-- Additive, safe. Reuses existing RLS-protected tables (projects, quotes,
-- project_knowledge_sources/chunks, project_pm_profiles, project_timeline_events).
-- No new tables => no new RLS policies required.
-- ---------------------------------------------------------------------------

-- Projects: enriched company fields sourced from the exact company website.
alter table public.projects add column if not exists company_website_url text;
alter table public.projects add column if not exists company_logo_url text;
alter table public.projects add column if not exists company_enriched_name text;
alter table public.projects add column if not exists company_enriched_description text;
alter table public.projects add column if not exists company_industry text;
alter table public.projects add column if not exists company_positioning text;
alter table public.projects add column if not exists company_product_type text;
alter table public.projects add column if not exists company_target_users text[] not null default '{}';
alter table public.projects add column if not exists company_key_features text[] not null default '{}';
alter table public.projects add column if not exists company_enrichment_status text not null default 'idle';
alter table public.projects add column if not exists company_enrichment_error text;
alter table public.projects add column if not exists company_enriched_at timestamptz;
alter table public.projects add column if not exists company_enrichment_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_company_enrichment_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_company_enrichment_status_check
      check (company_enrichment_status in ('idle', 'queued', 'processing', 'succeeded', 'failed'));
  end if;
end $$;

create index if not exists idx_projects_company_enrichment_status
  on public.projects (company_enrichment_status);

comment on column public.projects.company_website_url is
  'Exact company website provided by PM/admin. Enrichment scrapes only this domain (no broad web search).';
comment on column public.projects.company_enriched_description is
  'AI-enriched company/client description. project.description stays PM-editable; enrichment only fills when empty.';
comment on column public.projects.company_enrichment_metadata is
  'Full Firecrawl + AI enrichment payload: product_type, target_customers, use_cases, source_urls, confidence, warnings, pages, trace ids.';

-- Quotes (proposals): capture company website + the client''s original request message.
alter table public.quotes add column if not exists company_website_url text;
alter table public.quotes add column if not exists request_message text;

comment on column public.quotes.request_message is
  'The client''s original request / lead message / initial ask. Primary signal for initial Project Intelligence scope.';

-- Knowledge source types for scraped company website content.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'project_knowledge_sources_source_type_check'
      and conrelid = 'public.project_knowledge_sources'::regclass
  ) then
    alter table public.project_knowledge_sources
      drop constraint project_knowledge_sources_source_type_check;
  end if;

  alter table public.project_knowledge_sources
    add constraint project_knowledge_sources_source_type_check
    check (source_type in (
      'manual', 'uploaded_file', 'zoom_transcript', 'project_description',
      'figma', 'clickup', 'clickup_doc', 'slack', 'other',
      'meeting_transcript', 'slack_summary', 'client_feedback',
      'requirements_doc', 'design_notes', 'qa_notes', 'technical_notes',
      'delivery_update', 'unknown', 'agent',
      'company_website', 'company_website_page'
    ));
end $$;

-- Timeline event source_type: allow company_website enrichment events.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'project_timeline_events_source_type_check'
      and conrelid = 'public.project_timeline_events'::regclass
  ) then
    alter table public.project_timeline_events
      drop constraint project_timeline_events_source_type_check;
  end if;

  alter table public.project_timeline_events
    add constraint project_timeline_events_source_type_check
    check (source_type in (
      'slack', 'clickup', 'pm_action', 'zoom', 'figma', 'github',
      'manual', 'ai', 'other', 'company_website'
    ));
end $$;
