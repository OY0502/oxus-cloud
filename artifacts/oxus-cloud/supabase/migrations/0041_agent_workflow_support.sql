-- Agent workflow support: step dependencies for compound ClickUp actions
alter table public.agent_tool_runs
  add column if not exists workflow_id text,
  add column if not exists workflow_name text,
  add column if not exists step_key text,
  add column if not exists step_order int,
  add column if not exists depends_on text[] not null default '{}';

create index if not exists idx_agent_tool_runs_workflow_id
  on public.agent_tool_runs (workflow_id)
  where workflow_id is not null;

comment on column public.agent_tool_runs.workflow_id is
  'Groups related tool runs into a confirmable workflow (e.g. doc + task + link).';
