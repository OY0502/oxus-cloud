-- =============================================================================
-- Agency OS — Row Level Security
--
-- This is an internal collaboration tool: every authenticated team member
-- (a row in public.profiles) shares the same workspace and may read/write the
-- business data. Anonymous/unauthenticated requests get nothing.
--
-- profiles is the one exception: everyone can read the team directory, but a
-- user may only edit their own profile.
-- =============================================================================

-- Enable RLS everywhere.
alter table public.profiles            enable row level security;
alter table public.clients             enable row level security;
alter table public.contacts            enable row level security;
alter table public.team_members        enable row level security;
alter table public.deals               enable row level security;
alter table public.projects            enable row level security;
alter table public.project_assignees   enable row level security;
alter table public.quotes              enable row level security;
alter table public.quote_line_items    enable row level security;
alter table public.invoices            enable row level security;
alter table public.invoice_line_items  enable row level security;
alter table public.calendar_events     enable row level security;
alter table public.event_attendees     enable row level security;
alter table public.transactions        enable row level security;
alter table public.activities          enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_team" on public.profiles;
create policy "profiles_select_team"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Generic team-member full-access policy for each business table.
-- One FOR ALL policy keeps it readable and consistent; USING gates reads +
-- the existing-row side of writes, WITH CHECK gates new/edited rows.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  business_tables text[] := array[
    'clients', 'contacts', 'team_members', 'deals', 'projects',
    'project_assignees', 'quotes', 'quote_line_items', 'invoices',
    'invoice_line_items', 'calendar_events', 'event_attendees',
    'transactions', 'activities'
  ];
begin
  foreach t in array business_tables loop
    execute format('drop policy if exists "%1$s_team_all" on public.%1$s;', t);
    execute format(
      'create policy "%1$s_team_all" on public.%1$s
         for all to authenticated
         using (public.is_team_member())
         with check (public.is_team_member());',
      t
    );
  end loop;
end;
$$;
