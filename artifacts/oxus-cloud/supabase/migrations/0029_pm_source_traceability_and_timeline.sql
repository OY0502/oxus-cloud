-- PM action source traceability + unified project timeline

alter table public.project_pm_action_items
  add column if not exists source_type text,
  add column if not exists source_app text,
  add column if not exists source_label text,
  add column if not exists source_actor_name text,
  add column if not exists source_actor_email text,
  add column if not exists source_message text,
  add column if not exists source_message_ts timestamptz,
  add column if not exists source_url text,
  add column if not exists source_thread_key text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists change_history jsonb not null default '[]'::jsonb;

alter table public.project_pm_action_items
  drop constraint if exists project_pm_action_items_source_type_check;

alter table public.project_pm_action_items
  add constraint project_pm_action_items_source_type_check
  check (
    source_type is null
    or source_type in ('slack', 'clickup', 'zoom', 'figma', 'github', 'manual', 'ai', 'other')
  );

alter table public.project_pm_action_items
  drop constraint if exists project_pm_action_items_resolution_source_check;

alter table public.project_pm_action_items
  add constraint project_pm_action_items_resolution_source_check
  check (
    resolution_source is null
    or resolution_source in ('manual', 'clickup_signal', 'slack_signal', 'ai', 'dedupe')
  );

create index if not exists idx_pm_action_items_project_source_type
  on public.project_pm_action_items (project_id, source_type);

create index if not exists idx_pm_action_items_project_source_thread_key
  on public.project_pm_action_items (project_id, source_thread_key);

create index if not exists idx_pm_action_items_source_message_ts
  on public.project_pm_action_items (source_message_ts desc);

-- ---------------------------------------------------------------------------

create table if not exists public.project_timeline_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null,
  source_table text,
  source_id uuid,
  external_id text,
  event_type text not null,
  event_title text not null,
  event_summary text,
  event_body text,
  actor_name text,
  actor_email text,
  source_created_at timestamptz,
  priority text not null default 'medium',
  visibility text not null default 'internal',
  signal_type text,
  thread_key text,
  action_key text,
  related_pm_action_item_id uuid references public.project_pm_action_items(id) on delete set null,
  related_clickup_task_id text,
  related_slack_channel_id text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_timeline_events_source_type_check
    check (source_type in ('slack', 'clickup', 'pm_action', 'zoom', 'figma', 'github', 'manual', 'ai', 'other')),
  constraint project_timeline_events_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint project_timeline_events_visibility_check
    check (visibility in ('internal', 'external', 'client_safe'))
);

create unique index if not exists idx_project_timeline_events_source_dedupe
  on public.project_timeline_events (source_type, source_table, source_id)
  where source_id is not null;

create index if not exists idx_project_timeline_events_project_id
  on public.project_timeline_events (project_id);

create index if not exists idx_project_timeline_events_source_type
  on public.project_timeline_events (source_type);

create index if not exists idx_project_timeline_events_event_type
  on public.project_timeline_events (event_type);

create index if not exists idx_project_timeline_events_signal_type
  on public.project_timeline_events (signal_type);

create index if not exists idx_project_timeline_events_thread_key
  on public.project_timeline_events (thread_key);

create index if not exists idx_project_timeline_events_created_at
  on public.project_timeline_events (created_at desc);

create index if not exists idx_project_timeline_events_source_created_at
  on public.project_timeline_events (source_created_at desc);

create index if not exists idx_project_timeline_events_related_pm_action
  on public.project_timeline_events (related_pm_action_item_id);

alter table public.project_timeline_events enable row level security;

drop policy if exists "project_timeline_events_team_all" on public.project_timeline_events;
create policy "project_timeline_events_team_all"
  on public.project_timeline_events for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
