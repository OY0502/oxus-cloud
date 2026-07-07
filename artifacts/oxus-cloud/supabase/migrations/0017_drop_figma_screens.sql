-- Remove Figma screens gallery (project_figma_screens) and task screen linkage.

drop table if exists public.project_figma_screens;

drop index if exists public.idx_ai_proposed_tasks_figma_screen_name;

alter table public.ai_proposed_tasks
  drop column if exists figma_screen_name;
