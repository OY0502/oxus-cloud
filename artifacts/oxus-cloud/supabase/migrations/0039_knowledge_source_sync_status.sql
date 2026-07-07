-- Scope lifecycle for project knowledge sources (ClickUp docs cleanup without deletes)
alter table public.project_knowledge_sources
  add column if not exists sync_status text not null default 'active';

alter table public.project_knowledge_sources
  add column if not exists last_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_knowledge_sources_sync_status_check'
      and conrelid = 'public.project_knowledge_sources'::regclass
  ) then
    alter table public.project_knowledge_sources
      add constraint project_knowledge_sources_sync_status_check
      check (sync_status in ('active', 'out_of_scope', 'unknown_scope', 'archived', 'deleted'));
  end if;
end $$;

create index if not exists idx_project_knowledge_sources_project_sync_status
  on public.project_knowledge_sources (project_id, sync_status);

comment on column public.project_knowledge_sources.sync_status is
  'active = in-scope and used for retrieval; out_of_scope/unknown_scope excluded from agent context';

-- Vector search: only chunks from active sources
drop function if exists public.match_project_knowledge_chunks(uuid, vector, int);

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_project_id is null then
    raise exception 'p_project_id is required';
  end if;

  if not public.is_team_member() then
    raise exception 'not authorized';
  end if;

  return query
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
end;
$$;

revoke all on function public.match_project_knowledge_chunks(uuid, vector, int) from public;
grant execute on function public.match_project_knowledge_chunks(uuid, vector, int) to authenticated;
