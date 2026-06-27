-- =============================================================================
-- RLS for the new tables + a private Storage bucket for documents/attachments.
-- Mirrors the team-member full-access pattern from 0002_agency_os_rls.sql.
-- =============================================================================

alter table public.technologies enable row level security;
alter table public.comments     enable row level security;
alter table public.tasks        enable row level security;
alter table public.attachments  enable row level security;
alter table public.quotes       enable row level security;

-- Drop the legacy "deals" policy that carried over after the rename.
drop policy if exists "deals_team_all" on public.quotes;

do $$
declare
  t text;
  tbls text[] := array['technologies', 'comments', 'tasks', 'attachments', 'quotes'];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists "%1$s_team_all" on public.%1$s;', t);
    execute format(
      'create policy "%1$s_team_all" on public.%1$s
         for all to authenticated
         using (public.is_team_member())
         with check (public.is_team_member());',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private documents bucket + team-member access policies on storage.objects.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents_team_all" on storage.objects;
create policy "documents_team_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and public.is_team_member())
  with check (bucket_id = 'documents' and public.is_team_member());
