-- Structured ClickUp task draft fields for Slack-derived PM actions

alter table public.project_pm_action_items
  add column if not exists suggested_task_title text,
  add column if not exists suggested_task_description text,
  add column if not exists suggested_assignee_names text[] not null default '{}',
  add column if not exists suggested_clickup_assignee_ids text[] not null default '{}',
  add column if not exists suggested_due_date date,
  add column if not exists suggested_due_date_text text,
  add column if not exists suggested_priority text,
  add column if not exists task_draft_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_pm_action_items_suggested_priority_check'
  ) then
    alter table public.project_pm_action_items
      add constraint project_pm_action_items_suggested_priority_check
      check (suggested_priority is null or suggested_priority in ('low', 'medium', 'high', 'urgent'));
  end if;
end $$;
