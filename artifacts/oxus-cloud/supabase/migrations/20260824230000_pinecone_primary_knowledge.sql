-- Pinecone-primary project knowledge lifecycle.
-- Supabase remains the authorization, source registry, raw-content, and outbox
-- system; Pinecone owns retrieval/ranking once PINECONE_RETRIEVAL_MODE=primary.

alter table public.project_knowledge_sources
  add column if not exists content_version bigint not null default 1,
  add column if not exists content_hash text,
  add column if not exists index_status text not null default 'pending',
  add column if not exists indexed_at timestamptz,
  add column if not exists index_error text;

alter table public.project_knowledge_chunks
  add column if not exists content_version bigint not null default 1,
  add column if not exists content_hash text,
  add column if not exists section_path text;

update public.project_knowledge_sources
set content_hash = md5(coalesce(source_text, ''))
where content_hash is null;

update public.project_knowledge_chunks
set
  content_hash = md5(content),
  section_path = nullif(metadata ->> 'section_path', '')
where content_hash is null or section_path is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_knowledge_sources_index_status_check'
      and conrelid = 'public.project_knowledge_sources'::regclass
  ) then
    alter table public.project_knowledge_sources
      add constraint project_knowledge_sources_index_status_check
      check (index_status in ('pending', 'indexing', 'indexed', 'failed', 'deleted'));
  end if;
end $$;

create index if not exists idx_project_knowledge_sources_index_status
  on public.project_knowledge_sources(project_id, index_status, last_synced_at desc);

create index if not exists idx_project_knowledge_chunks_source_version
  on public.project_knowledge_chunks(source_id, content_version, chunk_index);

create table if not exists public.project_knowledge_index_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Intentionally no foreign key: a namespace-deletion job must survive the
  -- project row and its cascading children.
  project_id uuid not null,
  source_id uuid,
  action text not null check (action in ('upsert_project', 'upsert_source', 'delete_source', 'delete_namespace')),
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_knowledge_index_jobs_claim
  on public.project_knowledge_index_jobs(status, available_at, created_at)
  where status = 'pending';

alter table public.project_knowledge_index_jobs enable row level security;
revoke all on table public.project_knowledge_index_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.project_knowledge_index_jobs to service_role;

create or replace function public.enqueue_project_knowledge_index_job(
  p_project_id uuid,
  p_action text,
  p_source_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_key text;
begin
  if p_project_id is null then raise exception 'p_project_id is required'; end if;
  if p_action not in ('upsert_project', 'upsert_source', 'delete_source', 'delete_namespace') then
    raise exception 'unsupported knowledge index action';
  end if;
  if p_action in ('upsert_source', 'delete_source') and p_source_id is null then
    raise exception 'source action requires p_source_id';
  end if;

  v_key := p_project_id::text || ':' || p_action || ':' || coalesce(p_source_id::text, 'project');
  insert into public.project_knowledge_index_jobs (
    project_id, source_id, action, dedupe_key, status, attempts,
    available_at, locked_at, completed_at, last_error, metadata, updated_at
  ) values (
    p_project_id, p_source_id, p_action, v_key, 'pending', 0,
    now(), null, null, null, coalesce(p_metadata, '{}'::jsonb), now()
  )
  on conflict (dedupe_key) do update set
    status = 'pending',
    attempts = 0,
    available_at = now(),
    locked_at = null,
    completed_at = null,
    last_error = null,
    metadata = public.project_knowledge_index_jobs.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_project_knowledge_index_job(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_project_knowledge_index_job(uuid, text, uuid, jsonb)
  to service_role;

create or replace function public.claim_project_knowledge_index_jobs(
  p_limit integer default 10,
  p_project_id uuid default null
)
returns setof public.project_knowledge_index_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;

  -- Recover jobs whose worker disappeared after claiming them. Pinecone
  -- upserts and scoped deletes are idempotent, so replay is safe.
  update public.project_knowledge_index_jobs
  set
    status = 'failed',
    last_error = coalesce(last_error, 'Indexing worker lease expired after the retry limit.'),
    updated_at = now()
  where status = 'running'
    and locked_at < now() - interval '10 minutes'
    and attempts >= 5;

  return query
  with claimable as (
    select id
    from public.project_knowledge_index_jobs
    where (
        (status = 'pending' and available_at <= now())
        or (status = 'running' and locked_at < now() - interval '10 minutes')
      )
      and attempts < 5
      and (p_project_id is null or project_id = p_project_id)
    order by
      case action when 'delete_namespace' then 0 when 'delete_source' then 1 else 2 end,
      created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.project_knowledge_index_jobs jobs
    set status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
    from claimable
    where jobs.id = claimable.id
    returning jobs.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_project_knowledge_index_jobs(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_project_knowledge_index_jobs(integer, uuid)
  to service_role;

create or replace function public.prepare_project_knowledge_source_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.content_version := greatest(coalesce(new.content_version, 1), 1);
  elsif new.source_text is distinct from old.source_text then
    new.content_version := greatest(old.content_version + 1, 1);
  end if;
  new.content_hash := md5(coalesce(new.source_text, ''));
  if tg_op = 'INSERT'
     or new.source_text is distinct from old.source_text
     or new.sync_status is distinct from old.sync_status then
    new.index_status := case when new.sync_status = 'active' then 'pending' else 'deleted' end;
    new.index_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prepare_project_knowledge_source_version on public.project_knowledge_sources;
drop trigger if exists trg_prepare_project_knowledge_source_version_update on public.project_knowledge_sources;
create trigger trg_prepare_project_knowledge_source_version
  before insert on public.project_knowledge_sources
  for each row execute function public.prepare_project_knowledge_source_version();
create trigger trg_prepare_project_knowledge_source_version_update
  before update of source_text, sync_status on public.project_knowledge_sources
  for each row execute function public.prepare_project_knowledge_source_version();

create or replace function public.prepare_project_knowledge_chunk_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  source_content_version bigint;
begin
  select coalesce(content_version, 1)
  into source_content_version
  from public.project_knowledge_sources
  where id = new.source_id;
  new.content_version := coalesce(source_content_version, 1);
  new.content_hash := md5(new.content);
  new.section_path := coalesce(new.section_path, nullif(new.metadata ->> 'section_path', ''));
  return new;
end;
$$;

drop trigger if exists trg_prepare_project_knowledge_chunk_version on public.project_knowledge_chunks;
drop trigger if exists trg_prepare_project_knowledge_chunk_version_update on public.project_knowledge_chunks;
create trigger trg_prepare_project_knowledge_chunk_version
  before insert on public.project_knowledge_chunks
  for each row execute function public.prepare_project_knowledge_chunk_version();
create trigger trg_prepare_project_knowledge_chunk_version_update
  before update of content, metadata, chunk_index on public.project_knowledge_chunks
  for each row execute function public.prepare_project_knowledge_chunk_version();

create or replace function public.queue_project_knowledge_source_index_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_project_knowledge_index_job(old.project_id, 'delete_source', old.id);
    return old;
  end if;
  if new.sync_status = 'active' then
    perform public.enqueue_project_knowledge_index_job(new.project_id, 'upsert_source', new.id);
  else
    perform public.enqueue_project_knowledge_index_job(new.project_id, 'delete_source', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_queue_project_knowledge_source_index_change on public.project_knowledge_sources;
drop trigger if exists trg_queue_project_knowledge_source_index_update on public.project_knowledge_sources;
create trigger trg_queue_project_knowledge_source_index_change
  after insert or delete on public.project_knowledge_sources
  for each row execute function public.queue_project_knowledge_source_index_change();
create trigger trg_queue_project_knowledge_source_index_update
  after update of source_text, source_title, source_type, sync_status on public.project_knowledge_sources
  for each row execute function public.queue_project_knowledge_source_index_change();

create or replace function public.queue_project_knowledge_chunk_index_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_project_knowledge_index_job(new.project_id, 'upsert_source', new.source_id);
  return new;
end;
$$;

drop trigger if exists trg_queue_project_knowledge_chunk_index_change on public.project_knowledge_chunks;
drop trigger if exists trg_queue_project_knowledge_chunk_index_update on public.project_knowledge_chunks;
create trigger trg_queue_project_knowledge_chunk_index_change
  after insert on public.project_knowledge_chunks
  for each row execute function public.queue_project_knowledge_chunk_index_change();
create trigger trg_queue_project_knowledge_chunk_index_update
  after update of content, metadata, chunk_index on public.project_knowledge_chunks
  for each row execute function public.queue_project_knowledge_chunk_index_change();

create or replace function public.queue_project_pinecone_namespace_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_project_knowledge_index_job(old.id, 'delete_namespace', null);
  return old;
end;
$$;

drop trigger if exists trg_queue_project_pinecone_namespace_delete on public.projects;
create trigger trg_queue_project_pinecone_namespace_delete
  before delete on public.projects
  for each row execute function public.queue_project_pinecone_namespace_delete();

revoke all on function public.queue_project_knowledge_source_index_change()
  from public, anon, authenticated;
revoke all on function public.queue_project_knowledge_chunk_index_change()
  from public, anon, authenticated;
revoke all on function public.queue_project_pinecone_namespace_delete()
  from public, anon, authenticated;

insert into public.project_knowledge_index_jobs (project_id, action, dedupe_key, status)
select p.id, 'upsert_project', p.id::text || ':upsert_project:project', 'pending'
from public.projects p
where exists (
  select 1 from public.project_knowledge_sources s
  where s.project_id = p.id and coalesce(s.sync_status, 'active') = 'active'
)
on conflict (dedupe_key) do update set
  status = 'pending', available_at = now(), updated_at = now();

comment on table public.project_knowledge_index_jobs is
  'Durable Pinecone lifecycle outbox. Source/project mutations enqueue idempotent indexing or deletion work.';
comment on column public.project_knowledge_sources.content_version is
  'Monotonic source-text version used in Pinecone record IDs to prevent stale overwrites.';
comment on column public.project_knowledge_chunks.section_path is
  'Markdown/document section provenance used for contextual embeddings and answer citations.';
