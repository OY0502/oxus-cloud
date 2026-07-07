-- ---------------------------------------------------------------------------
-- Per-user ClickUp OAuth connections
-- ---------------------------------------------------------------------------

create table if not exists public.user_clickup_connections (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  clickup_user_id         text,
  clickup_username        text,
  clickup_email           text,
  access_token_encrypted  text not null,
  authorized_teams        jsonb not null default '[]'::jsonb,
  selected_team_id        text,
  selected_team_name      text,
  status                  text not null default 'active',
  connected_at            timestamptz not null default now(),
  last_verified_at        timestamptz,
  last_error              text,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint user_clickup_connections_user_id_unique unique (user_id),
  constraint user_clickup_connections_status_check
    check (status in ('active', 'revoked', 'error'))
);

create index if not exists idx_user_clickup_connections_user_id
  on public.user_clickup_connections (user_id);
create index if not exists idx_user_clickup_connections_clickup_user_id
  on public.user_clickup_connections (clickup_user_id);
create index if not exists idx_user_clickup_connections_selected_team_id
  on public.user_clickup_connections (selected_team_id);
create index if not exists idx_user_clickup_connections_status
  on public.user_clickup_connections (status);

create table if not exists public.clickup_oauth_states (
  id              uuid primary key default gen_random_uuid(),
  state           text not null unique,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  redirect_after  text,
  status          text not null default 'pending',
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint clickup_oauth_states_status_check
    check (status in ('pending', 'used', 'expired', 'failed'))
);

create index if not exists idx_clickup_oauth_states_state
  on public.clickup_oauth_states (state);
create index if not exists idx_clickup_oauth_states_user_id
  on public.clickup_oauth_states (user_id);
create index if not exists idx_clickup_oauth_states_expires_at
  on public.clickup_oauth_states (expires_at);

-- Safe view without encrypted token (for authenticated reads)
create or replace view public.user_clickup_connections_safe as
select
  id,
  user_id,
  clickup_user_id,
  clickup_username,
  clickup_email,
  authorized_teams,
  selected_team_id,
  selected_team_name,
  status,
  connected_at,
  last_verified_at,
  last_error,
  metadata,
  created_at,
  updated_at
from public.user_clickup_connections;

alter table public.user_clickup_connections enable row level security;
alter table public.clickup_oauth_states enable row level security;

drop policy if exists "user_clickup_connections_select_own_safe" on public.user_clickup_connections;
create policy "user_clickup_connections_select_own_safe"
  on public.user_clickup_connections for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_clickup_connections_delete_own" on public.user_clickup_connections;
create policy "user_clickup_connections_delete_own"
  on public.user_clickup_connections for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "clickup_oauth_states_select_own" on public.clickup_oauth_states;
create policy "clickup_oauth_states_select_own"
  on public.clickup_oauth_states for select to authenticated
  using (user_id = auth.uid());

grant select on public.user_clickup_connections_safe to authenticated;
