-- ---------------------------------------------------------------------------
-- Slack integration: workspace OAuth, project channel links, events
-- ---------------------------------------------------------------------------

create table if not exists public.slack_workspaces (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null unique,
  slack_team_name text,
  bot_user_id text,
  bot_access_token_encrypted text,
  installing_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active',
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slack_workspaces_status_check
    check (status in ('active', 'revoked', 'error'))
);

create index if not exists idx_slack_workspaces_slack_team_id on public.slack_workspaces (slack_team_id);
create index if not exists idx_slack_workspaces_status on public.slack_workspaces (status);

drop trigger if exists trg_slack_workspaces_updated_at on public.slack_workspaces;
create trigger trg_slack_workspaces_updated_at
  before update on public.slack_workspaces
  for each row execute function public.set_updated_at();

create table if not exists public.slack_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redirect_after text,
  status text not null default 'pending',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint slack_oauth_states_status_check
    check (status in ('pending', 'used', 'expired', 'failed'))
);

create index if not exists idx_slack_oauth_states_state on public.slack_oauth_states (state);
create index if not exists idx_slack_oauth_states_user_id on public.slack_oauth_states (user_id);
create index if not exists idx_slack_oauth_states_expires_at on public.slack_oauth_states (expires_at);

create table if not exists public.project_slack_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  slack_team_id text not null,
  slack_channel_id text not null,
  channel_name text,
  channel_type text,
  is_private boolean not null default false,
  is_shared boolean not null default false,
  is_ext_shared boolean not null default false,
  link_label text,
  link_type text not null default 'internal',
  purpose text,
  include_in_ai boolean not null default true,
  include_in_client_updates boolean not null default false,
  is_client_facing boolean not null default false,
  status text not null default 'active',
  last_synced_at timestamptz,
  last_event_ts text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_slack_links_project_team_channel_unique
    unique (project_id, slack_team_id, slack_channel_id),
  constraint project_slack_links_status_check
    check (status in ('active', 'disabled', 'error')),
  constraint project_slack_links_link_type_check
    check (link_type in ('internal', 'external', 'other'))
);

create index if not exists idx_project_slack_links_project_id on public.project_slack_links (project_id);
create index if not exists idx_project_slack_links_slack_team_id on public.project_slack_links (slack_team_id);
create index if not exists idx_project_slack_links_slack_channel_id on public.project_slack_links (slack_channel_id);
create index if not exists idx_project_slack_links_status on public.project_slack_links (status);
create index if not exists idx_project_slack_links_link_type on public.project_slack_links (link_type);

drop trigger if exists trg_project_slack_links_updated_at on public.project_slack_links;
create trigger trg_project_slack_links_updated_at
  before update on public.project_slack_links
  for each row execute function public.set_updated_at();

create table if not exists public.project_slack_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  project_slack_link_id uuid references public.project_slack_links(id) on delete set null,
  slack_team_id text not null,
  slack_channel_id text not null,
  slack_user_id text,
  slack_user_name text,
  slack_ts text not null,
  slack_thread_ts text,
  event_type text not null default 'message',
  message_text text,
  message_preview text,
  is_thread_reply boolean not null default false,
  is_bot_message boolean not null default false,
  link_type text,
  is_client_facing boolean not null default false,
  include_in_ai boolean not null default true,
  include_in_client_updates boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  signal_type text,
  signal_confidence numeric,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint project_slack_events_team_channel_ts_unique
    unique (slack_team_id, slack_channel_id, slack_ts),
  constraint project_slack_events_signal_confidence_check
    check (signal_confidence is null or signal_confidence between 0 and 1),
  constraint project_slack_events_link_type_check
    check (link_type is null or link_type in ('internal', 'external', 'other'))
);

create index if not exists idx_project_slack_events_project_id on public.project_slack_events (project_id);
create index if not exists idx_project_slack_events_link_id on public.project_slack_events (project_slack_link_id);
create index if not exists idx_project_slack_events_slack_team_id on public.project_slack_events (slack_team_id);
create index if not exists idx_project_slack_events_slack_channel_id on public.project_slack_events (slack_channel_id);
create index if not exists idx_project_slack_events_slack_thread_ts on public.project_slack_events (slack_thread_ts);
create index if not exists idx_project_slack_events_created_at on public.project_slack_events (created_at desc);
create index if not exists idx_project_slack_events_signal_type on public.project_slack_events (signal_type);
create index if not exists idx_project_slack_events_dedupe_key on public.project_slack_events (dedupe_key);
create index if not exists idx_project_slack_events_link_type on public.project_slack_events (link_type);

create or replace view public.slack_workspaces_safe as
select
  id,
  slack_team_id,
  slack_team_name,
  bot_user_id,
  installing_user_id,
  status,
  scopes,
  metadata,
  connected_at,
  last_verified_at,
  last_error,
  created_at,
  updated_at
from public.slack_workspaces;

alter table public.slack_workspaces enable row level security;
alter table public.slack_oauth_states enable row level security;
alter table public.project_slack_links enable row level security;
alter table public.project_slack_events enable row level security;

drop policy if exists "slack_workspaces_team_select" on public.slack_workspaces;
create policy "slack_workspaces_team_select"
  on public.slack_workspaces for select to authenticated
  using (public.is_team_member());

drop policy if exists "slack_workspaces_super_admin_delete" on public.slack_workspaces;
create policy "slack_workspaces_super_admin_delete"
  on public.slack_workspaces for delete to authenticated
  using (public.is_super_admin());

drop policy if exists "slack_oauth_states_select_own" on public.slack_oauth_states;
create policy "slack_oauth_states_select_own"
  on public.slack_oauth_states for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "project_slack_links_team_all" on public.project_slack_links;
create policy "project_slack_links_team_all"
  on public.project_slack_links for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "project_slack_events_team_all" on public.project_slack_events;
create policy "project_slack_events_team_all"
  on public.project_slack_events for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

grant select on public.slack_workspaces_safe to authenticated;
