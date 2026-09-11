-- Bounded Slack history imports were introduced after the original ingest
-- baseline. Keep the database constraint aligned with the link/sync functions.
alter table public.project_slack_links
  drop constraint if exists project_slack_links_sync_mode_check;

alter table public.project_slack_links
  add constraint project_slack_links_sync_mode_check
    check (sync_mode in ('new_messages_only', 'full_history', 'bounded_history'));

