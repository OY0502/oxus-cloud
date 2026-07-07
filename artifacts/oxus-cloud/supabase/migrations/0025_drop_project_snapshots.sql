-- Roll back project_snapshots (PM snapshot feature removed)

drop policy if exists "project_snapshots_team_all" on public.project_snapshots;

drop trigger if exists trg_project_snapshots_updated_at on public.project_snapshots;

drop table if exists public.project_snapshots;
