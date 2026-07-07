-- =============================================================================
-- ClickUp integration tables: project links, task mappings, timeline, webhook inbox
-- =============================================================================

-- Part 2: project–ClickUp link (one per project)
create table if not exists public.project_clickup_links (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null unique references public.projects(id) on delete cascade,
  clickup_team_id    text not null,
  clickup_space_id   text,
  clickup_folder_id  text,
  clickup_list_id    text,
  clickup_webhook_id text,
  space_name         text,
  folder_name        text,
  list_name          text,
  space_url          text,
  list_url           text,
  status             text not null default 'active',
  last_sync_at       timestamptz,
  last_error         text,
  metadata           jsonb not null default '{}'::jsonb,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint project_clickup_links_status_check
    check (status in ('active', 'disabled', 'error'))
);
create index if not exists idx_project_clickup_links_project_id   on public.project_clickup_links (project_id);
create index if not exists idx_project_clickup_links_team_id      on public.project_clickup_links (clickup_team_id);
create index if not exists idx_project_clickup_links_space_id     on public.project_clickup_links (clickup_space_id);
create index if not exists idx_project_clickup_links_list_id      on public.project_clickup_links (clickup_list_id);

drop trigger if exists trg_project_clickup_links_updated_at on public.project_clickup_links;
create trigger trg_project_clickup_links_updated_at
  before update on public.project_clickup_links
  for each row execute function public.set_updated_at();

alter table public.project_clickup_links enable row level security;
drop policy if exists "project_clickup_links_team_all" on public.project_clickup_links;
create policy "project_clickup_links_team_all"
  on public.project_clickup_links for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- Part 2 cont.: ClickUp task link (one per ClickUp task)
create table if not exists public.clickup_task_links (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  ai_proposed_task_id   uuid references public.ai_proposed_tasks(id) on delete set null,
  clickup_team_id       text not null,
  clickup_space_id      text,
  clickup_folder_id     text,
  clickup_list_id       text not null,
  clickup_task_id       text not null unique,
  clickup_task_url      text,
  clickup_task_name     text,
  clickup_status        text,
  clickup_priority      text,
  last_snapshot         jsonb,
  last_synced_at        timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_clickup_task_links_project_id          on public.clickup_task_links (project_id);
create index if not exists idx_clickup_task_links_ai_proposed_task_id on public.clickup_task_links (ai_proposed_task_id);
create index if not exists idx_clickup_task_links_clickup_task_id     on public.clickup_task_links (clickup_task_id);
create index if not exists idx_clickup_task_links_clickup_list_id     on public.clickup_task_links (clickup_list_id);

drop trigger if exists trg_clickup_task_links_updated_at on public.clickup_task_links;
create trigger trg_clickup_task_links_updated_at
  before update on public.clickup_task_links
  for each row execute function public.set_updated_at();

alter table public.clickup_task_links enable row level security;
drop policy if exists "clickup_task_links_team_all" on public.clickup_task_links;
create policy "clickup_task_links_team_all"
  on public.clickup_task_links for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- Part 2 cont.: ClickUp timeline events per project
create table if not exists public.project_clickup_timeline_events (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  clickup_task_link_id  uuid references public.clickup_task_links(id) on delete set null,
  clickup_task_id       text,
  event_type            text not null,
  event_title           text not null,
  event_summary         text,
  actor_name            text,
  actor_email           text,
  clickup_date          timestamptz,
  direction             text not null default 'from_clickup',
  source                text not null default 'webhook',
  raw_payload           jsonb not null default '{}'::jsonb,
  dedupe_key            text,
  created_at            timestamptz not null default now(),
  constraint project_clickup_timeline_events_direction_check
    check (direction in ('to_clickup', 'from_clickup')),
  constraint project_clickup_timeline_events_source_check
    check (source in ('webhook', 'manual_sync', 'oxus_action'))
);
create index if not exists idx_pct_events_project_id     on public.project_clickup_timeline_events (project_id);
create index if not exists idx_pct_events_clickup_task_id on public.project_clickup_timeline_events (clickup_task_id);
create index if not exists idx_pct_events_created_at     on public.project_clickup_timeline_events (created_at desc);
create index if not exists idx_pct_events_dedupe_key     on public.project_clickup_timeline_events (dedupe_key);
-- Partial unique index: dedupe_key must be unique when not null
create unique index if not exists idx_pct_events_dedupe_key_unique
  on public.project_clickup_timeline_events (dedupe_key)
  where dedupe_key is not null;

alter table public.project_clickup_timeline_events enable row level security;
drop policy if exists "project_clickup_timeline_events_team_all" on public.project_clickup_timeline_events;
create policy "project_clickup_timeline_events_team_all"
  on public.project_clickup_timeline_events for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- Part 2 cont.: Raw ClickUp webhook inbox (for debugging and idempotency)
create table if not exists public.clickup_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  clickup_webhook_id text,
  event_type         text,
  clickup_task_id    text,
  payload            jsonb not null,
  headers            jsonb not null default '{}'::jsonb,
  processed_at       timestamptz,
  processing_error   text,
  dedupe_key         text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_clickup_webhook_events_webhook_id    on public.clickup_webhook_events (clickup_webhook_id);
create index if not exists idx_clickup_webhook_events_task_id       on public.clickup_webhook_events (clickup_task_id);
create index if not exists idx_clickup_webhook_events_created_at    on public.clickup_webhook_events (created_at desc);
create index if not exists idx_clickup_webhook_events_dedupe_key    on public.clickup_webhook_events (dedupe_key);
create unique index if not exists idx_clickup_webhook_events_dedupe_unique
  on public.clickup_webhook_events (dedupe_key)
  where dedupe_key is not null;

-- Webhook events are written by the webhook Edge Function using the service role key,
-- so RLS allows authenticated team members to read, but we also need the function to insert.
alter table public.clickup_webhook_events enable row level security;
drop policy if exists "clickup_webhook_events_team_select" on public.clickup_webhook_events;
create policy "clickup_webhook_events_team_select"
  on public.clickup_webhook_events for select to authenticated
  using (public.is_team_member());

-- Part 3: ClickUp sync fields on ai_proposed_tasks
alter table public.ai_proposed_tasks
  add column if not exists clickup_task_id   text,
  add column if not exists clickup_task_url  text,
  add column if not exists clickup_sync_status text not null default 'not_synced',
  add column if not exists clickup_synced_at  timestamptz,
  add column if not exists clickup_sync_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_proposed_tasks_clickup_sync_status_check'
      and conrelid = 'public.ai_proposed_tasks'::regclass
  ) then
    alter table public.ai_proposed_tasks
      add constraint ai_proposed_tasks_clickup_sync_status_check
      check (clickup_sync_status in ('not_synced', 'syncing', 'synced', 'error'));
  end if;
end $$;

create index if not exists idx_ai_proposed_tasks_clickup_task_id     on public.ai_proposed_tasks (clickup_task_id);
create index if not exists idx_ai_proposed_tasks_clickup_sync_status on public.ai_proposed_tasks (clickup_sync_status);
