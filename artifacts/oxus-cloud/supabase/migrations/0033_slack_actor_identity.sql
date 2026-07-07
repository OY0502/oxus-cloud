-- Slack actor classification for internal vs client vs external messages

alter table public.project_slack_events
  add column if not exists actor_classification text,
  add column if not exists actor_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists actor_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists actor_is_project_contact boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_slack_events_actor_classification_check'
  ) then
    alter table public.project_slack_events
      add constraint project_slack_events_actor_classification_check
      check (actor_classification is null or actor_classification in ('internal', 'client', 'external', 'unknown'));
  end if;
end $$;

create index if not exists idx_project_slack_events_actor_classification
  on public.project_slack_events (actor_classification);

alter table public.project_signals
  add column if not exists actor_classification text,
  add column if not exists actor_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists actor_contact_id uuid references public.contacts(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_signals_actor_classification_check'
  ) then
    alter table public.project_signals
      add constraint project_signals_actor_classification_check
      check (actor_classification is null or actor_classification in ('internal', 'client', 'external', 'unknown'));
  end if;
end $$;

create index if not exists idx_project_signals_actor_classification
  on public.project_signals (actor_classification);
