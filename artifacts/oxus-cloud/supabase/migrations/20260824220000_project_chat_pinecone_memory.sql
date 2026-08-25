-- Pinecone is a chat-only secondary retrieval index. Supabase remains the
-- canonical store for content, permissions, lifecycle, and fallback search.
create table if not exists public.project_chat_vector_sync (
  project_id uuid primary key references public.projects(id) on delete cascade,
  provider text not null default 'pinecone' check (provider = 'pinecone'),
  index_name text not null,
  namespace text not null,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'syncing', 'ready', 'degraded')),
  vector_count integer not null default 0 check (vector_count >= 0),
  last_indexed_at timestamptz,
  last_queried_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_chat_vector_sync_status_idx
  on public.project_chat_vector_sync(status, updated_at desc);

alter table public.project_chat_vector_sync enable row level security;

drop policy if exists "Team members can read project chat vector sync" on public.project_chat_vector_sync;
create policy "Team members can read project chat vector sync"
  on public.project_chat_vector_sync
  for select
  to authenticated
  using (public.is_team_member());

comment on table public.project_chat_vector_sync is
  'Safe chat-memory index health and freshness metadata. API keys remain in Edge Function secrets.';
comment on column public.project_chat_vector_sync.namespace is
  'One Pinecone namespace per project for tenant isolation and inexpensive project deletion.';
