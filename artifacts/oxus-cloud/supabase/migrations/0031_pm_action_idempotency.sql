-- PM action idempotency: stable identity for upsert/dedupe

alter table public.project_pm_action_items
  add column if not exists action_identity text,
  add column if not exists source_signal_ids uuid[] not null default '{}',
  add column if not exists source_external_id text,
  add column if not exists last_dedupe_check_at timestamptz;

create index if not exists project_pm_action_items_project_action_identity_idx
  on public.project_pm_action_items (project_id, action_identity);

create index if not exists project_pm_action_items_project_source_thread_key_idx
  on public.project_pm_action_items (project_id, source_thread_key);

create index if not exists project_pm_action_items_source_signal_ids_gin_idx
  on public.project_pm_action_items using gin (source_signal_ids);

-- Partial unique index: skip if duplicates already exist (enforce in application code)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'project_pm_action_items_open_action_identity_unique'
  ) then
    begin
      create unique index project_pm_action_items_open_action_identity_unique
        on public.project_pm_action_items (project_id, action_identity)
        where action_identity is not null
          and status in ('open', 'in_progress');
    exception
      when unique_violation then
        raise notice 'Skipped unique index: duplicate open action_identity rows exist. Clean with dedupe-pm-actions first.';
    end;
  end if;
end $$;
