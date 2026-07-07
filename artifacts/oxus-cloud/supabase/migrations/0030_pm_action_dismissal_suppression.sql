-- PM action dismissal suppression: durable feedback when PM dismisses an action

alter table public.project_pm_action_items
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references public.profiles(id) on delete set null,
  add column if not exists dismiss_reason text,
  add column if not exists suppressed_signal_count integer not null default 0,
  add column if not exists latest_suppressed_at timestamptz,
  add column if not exists suppression_expires_at timestamptz;

alter table public.project_pm_action_items
  drop constraint if exists project_pm_action_items_resolution_source_check;

alter table public.project_pm_action_items
  add constraint project_pm_action_items_resolution_source_check
  check (
    resolution_source is null
    or resolution_source in ('manual', 'clickup_signal', 'slack_signal', 'ai', 'dedupe', 'dismissed')
  );

create index if not exists idx_pm_action_items_project_dismissed
  on public.project_pm_action_items (project_id, status)
  where status = 'dismissed';

create index if not exists idx_pm_action_items_project_source_thread_dismissed
  on public.project_pm_action_items (project_id, source_thread_key)
  where status = 'dismissed' and source_thread_key is not null;
