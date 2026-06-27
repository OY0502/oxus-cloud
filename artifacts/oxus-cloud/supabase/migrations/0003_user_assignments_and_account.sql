-- =============================================================================
-- App-user assignments (profiles) + account self-deletion
-- =============================================================================

-- Projects: assign to signed-in app users (profiles), not roster-only team_members
create table if not exists public.project_user_assignees (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_project_user_assignees_user on public.project_user_assignees (user_id);

-- Quotes: owner is an app user
alter table public.quotes
  add column if not exists assigned_user_id uuid references public.profiles(id) on delete set null;
create index if not exists idx_quotes_assigned_user on public.quotes (assigned_user_id);

-- Calendar events: attendees are app users
create table if not exists public.event_user_attendees (
  event_id    uuid not null references public.calendar_events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, user_id)
);
create index if not exists idx_event_user_attendees_user on public.event_user_attendees (user_id);

-- RLS for new tables
alter table public.project_user_assignees enable row level security;
alter table public.event_user_attendees enable row level security;

drop policy if exists "project_user_assignees_team_all" on public.project_user_assignees;
create policy "project_user_assignees_team_all"
  on public.project_user_assignees for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "event_user_attendees_team_all" on public.event_user_attendees;
create policy "event_user_attendees_team_all"
  on public.event_user_attendees for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- Allow users to delete their own auth account (danger zone in settings)
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_own_account() from anon, public;
grant execute on function public.delete_own_account() to authenticated;
