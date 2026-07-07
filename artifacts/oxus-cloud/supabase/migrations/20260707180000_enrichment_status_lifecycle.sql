-- ---------------------------------------------------------------------------
-- Standardize company enrichment status lifecycle.
-- Canonical statuses: not_started | queued | running | succeeded | failed.
-- Migrates the earlier values (idle -> not_started, processing -> running).
-- Additive + idempotent; does not touch enriched data.
-- ---------------------------------------------------------------------------

-- Drop the old constraint so we can remap values safely.
alter table public.projects
  drop constraint if exists projects_company_enrichment_status_check;

-- Remap legacy values to the canonical lifecycle.
update public.projects
  set company_enrichment_status = 'not_started'
  where company_enrichment_status is null or company_enrichment_status = 'idle';

update public.projects
  set company_enrichment_status = 'running'
  where company_enrichment_status = 'processing';

-- New default.
alter table public.projects
  alter column company_enrichment_status set default 'not_started';

-- Enforce the canonical set.
alter table public.projects
  add constraint projects_company_enrichment_status_check
  check (company_enrichment_status in ('not_started', 'queued', 'running', 'succeeded', 'failed'));
