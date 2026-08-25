-- One durable, project-scoped conversation. Chat messages are separate from
-- project knowledge so ordinary questions do not become permanent memory.
create table if not exists public.project_chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (length(btrim(content)) > 0),
  agent_run_id uuid references public.project_agent_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_chat_messages_project_created_idx
  on public.project_chat_messages(project_id, created_at desc);

create unique index if not exists project_chat_messages_run_role_idx
  on public.project_chat_messages(agent_run_id, role)
  where agent_run_id is not null;

alter table public.project_chat_messages enable row level security;

drop policy if exists "Team members can read project chat" on public.project_chat_messages;
create policy "Team members can read project chat"
  on public.project_chat_messages
  for select
  to authenticated
  using (public.is_team_member());

comment on table public.project_chat_messages is
  'Project-scoped chat transcript. Written by trusted Edge Functions; readable by team members.';
