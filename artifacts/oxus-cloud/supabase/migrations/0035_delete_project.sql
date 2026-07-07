-- Safe project deletion: removes polymorphic collab rows, then the project (FK cascades the rest).

create or replace function public.delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_pm_or_super_admin() then
    raise exception 'Only team members can delete projects.';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found.';
  end if;

  -- Polymorphic collab entities (no FK to projects).
  delete from public.comments
  where entity_type = 'project' and entity_id = p_project_id;

  delete from public.tasks
  where entity_type = 'project' and entity_id = p_project_id;

  delete from public.attachments
  where entity_type = 'project' and entity_id = p_project_id;

  -- Cascades project_* tables (PM memory, signals, ClickUp links, Slack events, AI briefs, etc.).
  delete from public.projects where id = p_project_id;
end;
$$;

revoke all on function public.delete_project(uuid) from public;
grant execute on function public.delete_project(uuid) to authenticated;
