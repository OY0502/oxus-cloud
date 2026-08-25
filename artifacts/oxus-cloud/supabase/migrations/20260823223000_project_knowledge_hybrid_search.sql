-- Project-scoped hybrid retrieval: exact terms + semantic similarity.
-- The function is callable only by trusted service-role workers.
alter table public.project_knowledge_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('simple', coalesce(content, ''))) stored;

create index if not exists idx_project_knowledge_chunks_fts
  on public.project_knowledge_chunks using gin (fts);

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
  with semantic as (
    select
      c.id,
      row_number() over (order by c.embedding <=> p_query_embedding) as rank,
      1 - (c.embedding <=> p_query_embedding) as similarity
    from public.project_knowledge_chunks c
    inner join public.project_knowledge_sources s on s.id = c.source_id
    where c.project_id = p_project_id
      and c.embedding is not null
      and coalesce(s.sync_status, 'active') = 'active'
    order by c.embedding <=> p_query_embedding
    limit greatest(3, least(coalesce(p_match_count, 8) * 3, 60))
  ),
  keyword as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(c.fts, websearch_to_tsquery('simple', p_query_text)) desc
      ) as rank
    from public.project_knowledge_chunks c
    inner join public.project_knowledge_sources s on s.id = c.source_id
    where c.project_id = p_project_id
      and c.fts @@ websearch_to_tsquery('simple', p_query_text)
      and coalesce(s.sync_status, 'active') = 'active'
    order by ts_rank_cd(c.fts, websearch_to_tsquery('simple', p_query_text)) desc
    limit greatest(3, least(coalesce(p_match_count, 8) * 3, 60))
  ),
  ranked as (
    select
      coalesce(semantic.id, keyword.id) as id,
      semantic.similarity,
      coalesce(1.0 / (60 + semantic.rank), 0.0) +
        coalesce(1.0 / (60 + keyword.rank), 0.0) as hybrid_score
    from semantic
    full outer join keyword on keyword.id = semantic.id
  )
  select
    c.id,
    c.source_id,
    c.content,
    c.metadata,
    c.category,
    ranked.similarity,
    ranked.hybrid_score
  from ranked
  inner join public.project_knowledge_chunks c on c.id = ranked.id
  order by ranked.hybrid_score desc, ranked.similarity desc nulls last
  limit greatest(1, least(coalesce(p_match_count, 8), 20));
$$;

revoke all on function public.hybrid_match_project_knowledge_chunks(uuid, text, vector, int)
  from public, anon, authenticated;
grant execute on function public.hybrid_match_project_knowledge_chunks(uuid, text, vector, int)
  to service_role;

-- Repair the original vector-only RPC as a secure service-role fallback.
create or replace function public.match_project_knowledge_chunks(
  p_project_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 10
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.source_id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.project_knowledge_chunks c
  inner join public.project_knowledge_sources s on s.id = c.source_id
  where c.project_id = p_project_id
    and c.embedding is not null
    and coalesce(s.sync_status, 'active') = 'active'
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 10), 50));
$$;

revoke all on function public.match_project_knowledge_chunks(uuid, vector, int)
  from public, anon, authenticated;
grant execute on function public.match_project_knowledge_chunks(uuid, vector, int)
  to service_role;
