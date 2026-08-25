-- Keep one durable RAG source per linked Slack thread. Raw messages remain in
-- project_slack_events; this index only protects the derived memory layer from
-- duplicate webhook deliveries and concurrent manual syncs.
create unique index if not exists idx_project_knowledge_sources_slack_thread_unique
  on public.project_knowledge_sources(project_id, external_provider, external_id)
  where external_provider = 'slack'
    and source_type = 'slack_summary'
    and external_id is not null;

comment on index public.idx_project_knowledge_sources_slack_thread_unique is
  'One current, source-linked Slack thread memory per project for Supabase/Pinecone retrieval.';
