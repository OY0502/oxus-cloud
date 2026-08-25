-- Multiple user-managed chat transcripts, all backed by the same project-level
-- knowledge and Pinecone namespace. Deleting a chat removes only its transcript;
-- durable project knowledge and agent/tool audit records remain intact.

create table if not exists public.project_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  title text not null default 'New chat' check (length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists project_chat_sessions_project_recent_idx
  on public.project_chat_sessions(project_id, last_message_at desc, created_at desc);

alter table public.project_chat_sessions enable row level security;

drop policy if exists "Team members can read project chats" on public.project_chat_sessions;
create policy "Team members can read project chats"
  on public.project_chat_sessions
  for select
  to authenticated
  using (public.is_team_member());

drop policy if exists "Team members can create project chats" on public.project_chat_sessions;
create policy "Team members can create project chats"
  on public.project_chat_sessions
  for insert
  to authenticated
  with check (public.is_team_member() and created_by = auth.uid());

drop policy if exists "Team members can delete project chats" on public.project_chat_sessions;
create policy "Team members can delete project chats"
  on public.project_chat_sessions
  for delete
  to authenticated
  using (public.is_team_member());

alter table public.project_chat_messages
  add column if not exists chat_session_id uuid references public.project_chat_sessions(id) on delete cascade;

alter table public.project_agent_runs
  add column if not exists chat_session_id uuid references public.project_chat_sessions(id) on delete set null;

-- Keep writes from an older frontend/Edge deployment valid during rollout.
-- New code always supplies chat_session_id; this trigger is a compatibility net.
create or replace function public.ensure_project_chat_message_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_session_id uuid;
begin
  if new.chat_session_id is not null then return new; end if;

  select id into resolved_session_id
  from public.project_chat_sessions
  where project_id = new.project_id
  order by last_message_at desc, created_at desc
  limit 1;

  if resolved_session_id is null then
    insert into public.project_chat_sessions (project_id, created_by, title, created_at, updated_at, last_message_at)
    values (new.project_id, new.user_id, 'New chat', new.created_at, new.created_at, new.created_at)
    returning id into resolved_session_id;
  end if;
  new.chat_session_id := resolved_session_id;
  return new;
end;
$$;

drop trigger if exists trg_ensure_project_chat_message_session on public.project_chat_messages;
create trigger trg_ensure_project_chat_message_session
  before insert on public.project_chat_messages
  for each row execute function public.ensure_project_chat_message_session();

revoke all on function public.ensure_project_chat_message_session()
  from public, anon, authenticated;

-- Preserve the existing project-wide transcript as one legacy session per
-- project. Projects without messages get a session lazily from the UI/API.
insert into public.project_chat_sessions (
  id,
  project_id,
  created_by,
  title,
  created_at,
  updated_at,
  last_message_at
)
select
  gen_random_uuid(),
  messages.project_id,
  (array_agg(messages.user_id order by messages.created_at)
    filter (where messages.user_id is not null))[1],
  'Previous chat',
  min(messages.created_at),
  max(messages.created_at),
  max(messages.created_at)
from public.project_chat_messages messages
where messages.chat_session_id is null
group by messages.project_id;

update public.project_chat_messages messages
set chat_session_id = sessions.id
from public.project_chat_sessions sessions
where messages.chat_session_id is null
  and sessions.project_id = messages.project_id
  and sessions.title = 'Previous chat';

update public.project_agent_runs runs
set chat_session_id = messages.chat_session_id
from public.project_chat_messages messages
where messages.agent_run_id = runs.id
  and runs.chat_session_id is null
  and messages.chat_session_id is not null;

alter table public.project_chat_messages
  alter column chat_session_id set not null;

create index if not exists project_chat_messages_session_created_idx
  on public.project_chat_messages(chat_session_id, created_at desc);

create index if not exists project_agent_runs_chat_session_idx
  on public.project_agent_runs(chat_session_id, created_at desc)
  where chat_session_id is not null;

create or replace function public.touch_project_chat_session_from_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.project_chat_sessions
  set
    title = case
      when new.role = 'user' and title in ('New chat', 'Previous chat') then
        left(regexp_replace(btrim(new.content), E'\\s+', ' ', 'g'), 120)
      else title
    end,
    last_message_at = greatest(last_message_at, new.created_at),
    updated_at = now()
  where id = new.chat_session_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_project_chat_session_from_message on public.project_chat_messages;
create trigger trg_touch_project_chat_session_from_message
  after insert on public.project_chat_messages
  for each row execute function public.touch_project_chat_session_from_message();

revoke all on function public.touch_project_chat_session_from_message()
  from public, anon, authenticated;

create or replace function public.prevent_running_project_chat_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.project_agent_runs
    where chat_session_id = old.id
      and status in ('pending', 'running')
  ) then
    raise exception 'This chat still has a running response.' using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_running_project_chat_delete on public.project_chat_sessions;
create trigger trg_prevent_running_project_chat_delete
  before delete on public.project_chat_sessions
  for each row execute function public.prevent_running_project_chat_delete();

revoke all on function public.prevent_running_project_chat_delete()
  from public, anon, authenticated;

comment on table public.project_chat_sessions is
  'User-managed project chat transcripts. Every session retrieves from the same project-scoped durable knowledge.';
comment on column public.project_chat_messages.chat_session_id is
  'Conversation-continuity boundary. This does not scope durable project-memory retrieval.';
