-- Prefer operational evidence for temporal PM questions without suppressing
-- evergreen company context for general questions.
create or replace function public.hybrid_match_project_knowledge_chunks(
  p_project_id uuid,
  p_query_text text,
  p_query_embedding vector(1536),
  p_match_count int default 8
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  metadata jsonb,
  category text,
  similarity float,
  hybrid_score float
)
language sql
stable
security invoker
set search_path = public
as $$
  with request as (
    select
      greatest(1, least(coalesce(p_match_count, 8), 30)) as wanted,
      coalesce(p_query_text, '') ~* '(current|latest|recent|today|as of|this week|changed|blocker|risk|progress|priority|status|attention|next|update)' as temporal
  ),
  vector_ranked as (
    select
      c.id,
      c.source_id,
      c.content,
      c.metadata || jsonb_strip_nulls(jsonb_build_object(
        'source_title', s.source_title,
        'source_type', s.source_type,
        'source_created_at', s.created_at
      )) as metadata,
      c.category,
      row_number() over (order by c.embedding <=> p_query_embedding) as rank,
      1 - (c.embedding <=> p_query_embedding) as similarity,
      s.source_type
    from public.project_knowledge_chunks c
    inner join public.project_knowledge_sources s on s.id = c.source_id
    cross join request r
    where c.project_id = p_project_id
      and c.embedding is not null
      and coalesce(s.sync_status, 'active') = 'active'
    order by c.embedding <=> p_query_embedding
    limit (select wanted * 5 from request)
  ),
  keyword_ranked as (
    select
      c.id,
      c.source_id,
      c.content,
      c.metadata || jsonb_strip_nulls(jsonb_build_object(
        'source_title', s.source_title,
        'source_type', s.source_type,
        'source_created_at', s.created_at
      )) as metadata,
      c.category,
      row_number() over (
        order by ts_rank_cd(c.fts, websearch_to_tsquery('simple', p_query_text)) desc
      ) as rank,
      ts_rank_cd(c.fts, websearch_to_tsquery('simple', p_query_text)) as text_rank,
      s.source_type
    from public.project_knowledge_chunks c
    inner join public.project_knowledge_sources s on s.id = c.source_id
    cross join request r
    where c.project_id = p_project_id
      and coalesce(s.sync_status, 'active') = 'active'
      and c.fts @@ websearch_to_tsquery('simple', p_query_text)
    order by ts_rank_cd(c.fts, websearch_to_tsquery('simple', p_query_text)) desc
    limit (select wanted * 5 from request)
  ),
  combined as (
    select
      coalesce(v.id, k.id) as id,
      coalesce(v.source_id, k.source_id) as source_id,
      coalesce(v.content, k.content) as content,
      coalesce(v.metadata, k.metadata) as metadata,
      coalesce(v.category, k.category) as category,
      v.similarity as similarity,
      coalesce(v.source_type, k.source_type) as source_type,
      coalesce(1.0 / (60 + v.rank), 0.0) +
        coalesce(1.0 / (60 + k.rank), 0.0) as reciprocal_rank
    from vector_ranked v
    full outer join keyword_ranked k on k.id = v.id
  )
  select
    c.id,
    c.source_id,
    c.content,
    c.metadata,
    c.category,
    c.similarity,
    c.reciprocal_rank *
      case
        when r.temporal and c.source_type in (
          'clickup', 'clickup_doc', 'slack', 'slack_summary',
          'client_feedback', 'delivery_update'
        ) then 1.35
        when r.temporal and c.source_type in (
          'meeting_transcript', 'zoom_transcript', 'agent'
        ) then 1.20
        when r.temporal and c.source_type in (
          'company_website', 'company_website_page'
        ) then 0.70
        when not r.temporal and c.source_type in (
          'company_website', 'company_website_page'
        ) then 1.05
        else 1.0
      end as hybrid_score
  from combined c
  cross join request r
  order by hybrid_score desc, similarity desc nulls last
  limit (select wanted from request);
$$;

revoke all on function public.hybrid_match_project_knowledge_chunks(uuid, text, vector, int)
  from public, anon, authenticated;
grant execute on function public.hybrid_match_project_knowledge_chunks(uuid, text, vector, int)
  to service_role;

comment on function public.hybrid_match_project_knowledge_chunks(uuid, text, vector, int) is
  'Service-role-only hybrid project retrieval with temporal source weighting and source provenance metadata.';
