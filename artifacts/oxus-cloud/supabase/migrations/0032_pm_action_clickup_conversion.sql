-- PM action → ClickUp task conversion (Slack-derived work requests)

alter table public.project_pm_action_items
  add column if not exists clickup_task_id text,
  add column if not exists clickup_task_url text,
  add column if not exists clickup_sync_status text not null default 'not_synced',
  add column if not exists clickup_synced_at timestamptz,
  add column if not exists clickup_sync_error text,
  add column if not exists selected_clickup_assignee_ids text[] not null default '{}',
  add column if not exists selected_due_date date,
  add column if not exists selected_due_date_time boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_pm_action_items_clickup_sync_status_check'
  ) then
    alter table public.project_pm_action_items
      add constraint project_pm_action_items_clickup_sync_status_check
      check (clickup_sync_status in ('not_synced', 'syncing', 'synced', 'error'));
  end if;
end $$;

create index if not exists idx_project_pm_action_items_clickup_task_id
  on public.project_pm_action_items (clickup_task_id);

create index if not exists idx_project_pm_action_items_clickup_sync_status
  on public.project_pm_action_items (clickup_sync_status);

alter table public.clickup_task_links
  add column if not exists pm_action_item_id uuid references public.project_pm_action_items(id) on delete set null;

create index if not exists idx_clickup_task_links_pm_action_item_id
  on public.clickup_task_links (pm_action_item_id);

create unique index if not exists idx_clickup_task_links_pm_action_item_id_unique
  on public.clickup_task_links (pm_action_item_id)
  where pm_action_item_id is not null;
