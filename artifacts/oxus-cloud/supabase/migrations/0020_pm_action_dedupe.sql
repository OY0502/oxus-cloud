-- ---------------------------------------------------------------------------
-- PM action item dedupe/grouping for repeated blockers
-- ---------------------------------------------------------------------------

alter table public.project_pm_action_items
  add column if not exists action_key text,
  add column if not exists blocker_type text,
  add column if not exists blocker_resource text,
  add column if not exists blocked_actor_name text,
  add column if not exists blocked_actor_email text,
  add column if not exists related_clickup_task_ids text[] not null default '{}',
  add column if not exists related_clickup_task_titles text[] not null default '{}',
  add column if not exists signal_count integer not null default 1,
  add column if not exists first_signal_at timestamptz,
  add column if not exists latest_signal_at timestamptz,
  add column if not exists last_signal_summary text,
  add column if not exists resolution_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_pm_action_items_blocker_type_check'
      and conrelid = 'public.project_pm_action_items'::regclass
  ) then
    alter table public.project_pm_action_items
      add constraint project_pm_action_items_blocker_type_check
      check (blocker_type is null or blocker_type in (
        'access', 'credentials', 'permissions', 'blocked_work', 'dependency', 'unclear_requirements', 'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'project_pm_action_items_signal_count_check'
      and conrelid = 'public.project_pm_action_items'::regclass
  ) then
    alter table public.project_pm_action_items
      add constraint project_pm_action_items_signal_count_check
      check (signal_count >= 1);
  end if;
end $$;

create index if not exists idx_project_pm_action_items_project_action_key
  on public.project_pm_action_items (project_id, action_key);
create index if not exists idx_project_pm_action_items_project_blocker_type
  on public.project_pm_action_items (project_id, blocker_type);
create index if not exists idx_project_pm_action_items_latest_signal_at
  on public.project_pm_action_items (latest_signal_at desc);
create index if not exists idx_project_pm_action_items_related_clickup_task_ids
  on public.project_pm_action_items using gin (related_clickup_task_ids);

create unique index if not exists project_pm_action_items_active_action_key_unique
  on public.project_pm_action_items (project_id, action_key)
  where action_key is not null and status in ('open', 'in_progress');
