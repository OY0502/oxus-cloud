-- PM action lifecycle: comment thread metadata + auto-resolution fields

alter table public.project_clickup_timeline_events
  add column if not exists clickup_comment_id text,
  add column if not exists clickup_parent_comment_id text,
  add column if not exists clickup_thread_id text,
  add column if not exists comment_text text;

create index if not exists idx_pct_events_clickup_comment_id
  on public.project_clickup_timeline_events (clickup_comment_id)
  where clickup_comment_id is not null;

create index if not exists idx_pct_events_clickup_thread_id
  on public.project_clickup_timeline_events (clickup_thread_id)
  where clickup_thread_id is not null;

create index if not exists idx_pct_events_clickup_parent_comment_id
  on public.project_clickup_timeline_events (clickup_parent_comment_id)
  where clickup_parent_comment_id is not null;

alter table public.project_pm_action_items
  add column if not exists auto_resolved_by_event_id uuid references public.project_clickup_timeline_events(id) on delete set null,
  add column if not exists auto_resolved_reason text,
  add column if not exists resolution_source text;

alter table public.project_pm_action_items
  drop constraint if exists project_pm_action_items_resolution_source_check;

alter table public.project_pm_action_items
  add constraint project_pm_action_items_resolution_source_check
  check (resolution_source is null or resolution_source in ('manual', 'clickup_signal', 'ai', 'dedupe'));
