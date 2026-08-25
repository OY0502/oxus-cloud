-- Supabase Advisor cleanup and Stripe inbox reliability hardening.

-- These tables are backend-only. Enabling RLS without user policies keeps
-- them accessible to service_role workers while removing PostgREST exposure.
alter table if exists public.fx_rates enable row level security;
alter table if exists public.google_gmail_threads enable row level security;
alter table if exists public.google_import_batch_checkpoints enable row level security;
alter table if exists public.google_import_source_runs enable row level security;
alter table if exists public.google_relationship_groups enable row level security;

revoke all on table public.fx_rates from anon, authenticated;
revoke all on table public.google_gmail_threads from anon, authenticated;
revoke all on table public.google_import_batch_checkpoints from anon, authenticated;
revoke all on table public.google_import_source_runs from anon, authenticated;
revoke all on table public.google_relationship_groups from anon, authenticated;

-- Views exposed through PostgREST must enforce the querying user's RLS rather
-- than running with the view owner's privileges.
alter view if exists public.user_clickup_connections_safe set (security_invoker = true);
alter view if exists public.slack_workspaces_safe set (security_invoker = true);
alter view if exists public.companies set (security_invoker = true);
alter view if exists public.people set (security_invoker = true);
alter view if exists public.unallocated_payouts_report set (security_invoker = true);
alter view if exists public.user_google_connections_safe set (security_invoker = true);

-- Pin every function currently reported by Advisor to trusted schemas. This
-- prevents object shadowing through a caller-controlled search_path.
alter function public.set_pm_attention_updated_at() set search_path = public, pg_temp;
alter function public.normalize_auth_email(text) set search_path = public, pg_temp;
alter function public.team_member_rate_scope_key(uuid, text) set search_path = public, pg_temp;
alter function public.compute_team_member_rate_status(date, date) set search_path = public, pg_temp;
alter function public.rate_is_active_on_date(date, date, date) set search_path = public, pg_temp;
alter function public.validate_team_member_rate_overlap(uuid, uuid, uuid[], text, boolean, date, date)
  set search_path = public, pg_temp;
alter function public.validate_team_member_rate_overlap(uuid, uuid, uuid, text, boolean, date, date)
  set search_path = public, pg_temp;

-- SECURITY DEFINER routines must never inherit PostgreSQL's default PUBLIC
-- execute grant. Keep user-facing RPCs available only to signed-in users and
-- reserve worker/trigger helpers for service_role or database triggers.
revoke execute on function public.archive_project(uuid, text) from public, anon;
revoke execute on function public.change_team_member_rate(uuid, text, numeric, text, date, text) from public, anon;
revoke execute on function public.check_team_member_rate_conflicts(uuid, uuid, uuid[], text, boolean, date, date) from public, anon;
revoke execute on function public.create_team_member_rate(uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text) from public, anon;
revoke execute on function public.create_team_member_rate(uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text, uuid[]) from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.delete_project(uuid) from public, anon;
revoke execute on function public.delete_team_member_rate(uuid) from public, anon;
revoke execute on function public.delete_workspace_user(uuid) from public, anon;
revoke execute on function public.end_team_member_rate(uuid, date) from public, anon;
revoke execute on function public.is_auth_email_confirmed() from public, anon;
revoke execute on function public.is_internal_oxus_email(text) from public, anon;
revoke execute on function public.is_pm_or_super_admin() from public, anon;
revoke execute on function public.is_profile_access_active() from public, anon;
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.replace_team_member_rate(uuid, date, text, text, numeric, text, text, text) from public, anon;
revoke execute on function public.restore_project(uuid) from public, anon;
revoke execute on function public.set_default_team_member_rate(uuid) from public, anon;
revoke execute on function public.set_profile_access_status(uuid, text) from public, anon;
revoke execute on function public.set_profile_role(uuid, text) from public, anon;
revoke execute on function public.sync_team_member_rate_projects(uuid, uuid[]) from public, anon;
revoke execute on function public.team_member_rate_is_used(uuid) from public, anon;
revoke execute on function public.update_team_member_rate(uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean) from public, anon;
revoke execute on function public.update_team_member_rate(uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean, uuid[]) from public, anon;

grant execute on function public.archive_project(uuid, text) to authenticated;
grant execute on function public.change_team_member_rate(uuid, text, numeric, text, date, text) to authenticated;
grant execute on function public.check_team_member_rate_conflicts(uuid, uuid, uuid[], text, boolean, date, date) to authenticated;
grant execute on function public.create_team_member_rate(uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text) to authenticated;
grant execute on function public.create_team_member_rate(uuid, text, text, numeric, text, uuid, text, boolean, date, date, text, text, uuid[]) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;
grant execute on function public.delete_team_member_rate(uuid) to authenticated;
grant execute on function public.delete_workspace_user(uuid) to authenticated;
grant execute on function public.end_team_member_rate(uuid, date) to authenticated;
grant execute on function public.is_auth_email_confirmed() to authenticated;
grant execute on function public.is_internal_oxus_email(text) to authenticated;
grant execute on function public.is_pm_or_super_admin() to authenticated;
grant execute on function public.is_profile_access_active() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.replace_team_member_rate(uuid, date, text, text, numeric, text, text, text) to authenticated;
grant execute on function public.restore_project(uuid) to authenticated;
grant execute on function public.set_default_team_member_rate(uuid) to authenticated;
grant execute on function public.set_profile_access_status(uuid, text) to authenticated;
grant execute on function public.set_profile_role(uuid, text) to authenticated;
grant execute on function public.sync_team_member_rate_projects(uuid, uuid[]) to authenticated;
grant execute on function public.team_member_rate_is_used(uuid) to authenticated;
grant execute on function public.update_team_member_rate(uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean) to authenticated;
grant execute on function public.update_team_member_rate(uuid, text, text, text, numeric, text, uuid, text, boolean, date, date, text, boolean, uuid[]) to authenticated;

revoke execute on function public.match_project_knowledge_chunks(uuid, public.vector, integer) from public, anon, authenticated;
revoke execute on function public.process_client_invoice_payable_release(uuid) from public, anon, authenticated;
revoke execute on function public.recalculate_crm_interaction_dates(uuid) from public, anon, authenticated;
revoke execute on function public.rate_has_project_links(uuid) from public, anon, authenticated;
revoke execute on function public.sync_contractor_invoice_payment_status(uuid) from public, anon, authenticated;

grant execute on function public.match_project_knowledge_chunks(uuid, public.vector, integer) to service_role;
grant execute on function public.process_client_invoice_payable_release(uuid) to service_role;
grant execute on function public.recalculate_crm_interaction_dates(uuid) to service_role;
grant execute on function public.rate_has_project_links(uuid) to service_role;
grant execute on function public.sync_contractor_invoice_payment_status(uuid) to service_role;

revoke execute on function public.handle_team_member_rate_project_removed() from public, anon, authenticated;
revoke execute on function public.handle_user_email_confirmed() from public, anon, authenticated;
revoke execute on function public.protect_profile_access_status() from public, anon, authenticated;
revoke execute on function public.protect_profile_role() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.trg_invoices_payable_release() from public, anon, authenticated;
revoke execute on function public.trg_sync_contractor_invoice_payment_status() from public, anon, authenticated;

-- Evaluate auth helpers once per statement instead of once per row. These are
-- semantic no-ops that remove the Advisor "Auth RLS Initialization Plan"
-- findings on frequently queried policies.
alter policy "profiles_update_self" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
alter policy "profiles_insert_self" on public.profiles
  with check (
    id = (select auth.uid())
    and public.is_internal_oxus_email(coalesce(email, (select auth.jwt()) ->> 'email'))
  );

alter policy "user_clickup_connections_select_own_safe" on public.user_clickup_connections
  using (user_id = (select auth.uid()));
alter policy "user_clickup_connections_delete_own" on public.user_clickup_connections
  using (user_id = (select auth.uid()));
alter policy "clickup_oauth_states_select_own" on public.clickup_oauth_states
  using (user_id = (select auth.uid()));
alter policy "slack_oauth_states_select_own" on public.slack_oauth_states
  using (user_id = (select auth.uid()));

alter policy "user_google_connections_select_own" on public.user_google_connections
  using (user_id = (select auth.uid()) or public.is_super_admin());
alter policy "user_google_connections_delete_own" on public.user_google_connections
  using (user_id = (select auth.uid()));
alter policy "google_oauth_states_select_own" on public.google_oauth_states
  using (user_id = (select auth.uid()));
alter policy "google_sync_states_select" on public.google_sync_states
  using (owner_user_id = (select auth.uid()) or public.is_super_admin());
alter policy "google_import_runs_select" on public.google_import_runs
  using (owner_user_id = (select auth.uid()) or public.is_super_admin());
alter policy "google_interactions_select" on public.google_interactions
  using (owner_user_id = (select auth.uid()) or public.is_super_admin());
alter policy crm_user_preferences_self on public.crm_user_preferences
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy google_calendar_attendees_team on public.google_calendar_attendees
  using (owner_user_id = (select auth.uid()) or public.is_super_admin() or public.is_team_member());
alter policy crm_source_people_team on public.crm_source_people
  using (owner_user_id = (select auth.uid()) or public.is_super_admin() or public.is_team_member());
alter policy crm_source_companies_team on public.crm_source_companies
  using (owner_user_id = (select auth.uid()) or public.is_super_admin() or public.is_team_member());
alter policy crm_source_interactions_team on public.crm_source_interactions
  using (owner_user_id = (select auth.uid()) or public.is_super_admin() or public.is_team_member());
alter policy person_identities_team on public.person_identities
  using (owner_user_id = (select auth.uid()) or public.is_super_admin() or public.is_team_member());
alter policy company_identities_team on public.company_identities
  using (owner_user_id = (select auth.uid()) or public.is_super_admin() or public.is_team_member());
alter policy crm_resolver_runs_team on public.crm_resolver_runs
  using (owner_user_id = (select auth.uid()) or public.is_super_admin());
alter policy "google_cal_hist_cursors_select" on public.google_calendar_historical_cursors
  using (owner_user_id = (select auth.uid()) or public.is_super_admin());
alter policy crm_review_decisions_select on public.crm_review_decisions
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('super_admin', 'pm')
    )
  );

-- A FOR ALL write policy also applies to SELECT and overlaps the dedicated
-- read policy. Split writes by command to keep the same access rules without
-- evaluating multiple permissive SELECT policies.
drop policy if exists company_people_write on public.company_people;
create policy company_people_insert on public.company_people
  for insert to authenticated with check (public.is_super_admin());
create policy company_people_update on public.company_people
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy company_people_delete on public.company_people
  for delete to authenticated using (public.is_super_admin());

drop policy if exists crm_record_insights_write on public.crm_record_insights;
create policy crm_record_insights_insert on public.crm_record_insights
  for insert to authenticated with check (public.is_pm_or_super_admin());
create policy crm_record_insights_update on public.crm_record_insights
  for update to authenticated using (public.is_pm_or_super_admin()) with check (public.is_pm_or_super_admin());
create policy crm_record_insights_delete on public.crm_record_insights
  for delete to authenticated using (public.is_pm_or_super_admin());

drop policy if exists invoice_payment_reconciliations_write_super_admin
  on public.invoice_payment_reconciliations;
create policy invoice_payment_reconciliations_insert_super_admin
  on public.invoice_payment_reconciliations for insert to authenticated
  with check (public.is_super_admin() and public.is_team_member());
create policy invoice_payment_reconciliations_update_super_admin
  on public.invoice_payment_reconciliations for update to authenticated
  using (public.is_super_admin() and public.is_team_member())
  with check (public.is_super_admin() and public.is_team_member());
create policy invoice_payment_reconciliations_delete_super_admin
  on public.invoice_payment_reconciliations for delete to authenticated
  using (public.is_super_admin() and public.is_team_member());

drop policy if exists pandadoc_integration_state_write on public.pandadoc_integration_state;
create policy pandadoc_integration_state_insert on public.pandadoc_integration_state
  for insert to authenticated with check (public.is_super_admin());
create policy pandadoc_integration_state_update on public.pandadoc_integration_state
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy pandadoc_integration_state_delete on public.pandadoc_integration_state
  for delete to authenticated using (public.is_super_admin());

drop policy if exists stripe_integration_state_write on public.stripe_integration_state;
create policy stripe_integration_state_insert on public.stripe_integration_state
  for insert to authenticated with check (public.is_super_admin());
create policy stripe_integration_state_update on public.stripe_integration_state
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy stripe_integration_state_delete on public.stripe_integration_state
  for delete to authenticated using (public.is_super_admin());

-- Keep the original, consistently named index and remove its identical copy.
drop index if exists public.project_pm_action_items_project_source_thread_key_idx;

-- Recovery scans use this partial index to reclaim crashed workers cheaply.
create index if not exists idx_stripe_webhook_events_processing_lease
  on public.stripe_webhook_events (processing_started_at)
  where status = 'processing';
