-- Slack channel ingest baseline: ignore historical messages by default when linking.

alter table public.project_slack_links
  add column if not exists ingest_from_ts text,
  add column if not exists last_processed_ts text,
  add column if not exists ignore_history_before_ts timestamptz,
  add column if not exists sync_mode text not null default 'new_messages_only';

alter table public.project_slack_links
  drop constraint if exists project_slack_links_sync_mode_check;

alter table public.project_slack_links
  add constraint project_slack_links_sync_mode_check
    check (sync_mode in ('new_messages_only', 'full_history'));

-- Existing links: set baseline to now only when no safe previous value exists.
update public.project_slack_links
set
  ingest_from_ts = coalesce(
    ingest_from_ts,
    case when last_event_ts is not null and last_event_ts <> '' then last_event_ts else null end,
    (floor(extract(epoch from now()))::bigint::text || '.' || lpad((floor((extract(epoch from now()) - floor(extract(epoch from now()))) * 1000000)::bigint)::text, 6, '0'))
  ),
  ignore_history_before_ts = coalesce(ignore_history_before_ts, now()),
  sync_mode = coalesce(nullif(sync_mode, ''), 'new_messages_only')
where ingest_from_ts is null or ignore_history_before_ts is null;
