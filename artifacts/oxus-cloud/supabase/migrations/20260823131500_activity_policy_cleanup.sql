-- Remove redundant super-admin policies reported by Supabase Advisor.
-- The canonical per-command policies already include the same access:
-- activities_select includes super admins, activities_insert permits all team
-- members, and activities_update/delete require super-admin access.

drop policy if exists activities_select_super_admin on public.activities;
drop policy if exists activities_insert_super_admin on public.activities;
drop policy if exists activities_update_super_admin on public.activities;
drop policy if exists activities_delete_super_admin on public.activities;
