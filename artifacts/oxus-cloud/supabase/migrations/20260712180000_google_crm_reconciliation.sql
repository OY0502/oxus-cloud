-- Google CRM reconciliation support + company candidate dedup + calendar event counts

create unique index if not exists idx_crm_entity_candidates_pending_company_domain
  on public.crm_entity_candidates (owner_user_id, entity_type, lower(domain))
  where status = 'pending' and entity_type = 'company' and domain is not null;

-- Track calendar event counts in sync state metadata (updated by worker)
comment on column public.google_sync_states.metadata is 'Worker metadata including event_count per calendar';
