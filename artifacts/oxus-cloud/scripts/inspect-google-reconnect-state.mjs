/**
 * Read-only production inspection for Google reconnect incident.
 * Does not print secrets or tokens.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  for (const path of [".env.local", ".env"]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      if (!process.env[key]) {
        process.env[key] = m[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(JSON.stringify({ ok: false, reason: "MISSING_ENV", hasUrl: !!url, hasKey: !!key }));
  process.exit(1);
}

const projectRef = new URL(url).hostname.split(".")[0];
const sb = createClient(url, key, { auth: { persistSession: false } });

const email = process.argv[2] || "hello@oxus.agency";

const { data: connection, error: connErr } = await sb
  .from("user_google_connections")
  .select(`
    id, user_id, google_account_id, google_email, status,
    connected_at, disconnected_at, last_successful_sync_at,
    contacts_last_synced_at, calendar_last_synced_at, gmail_last_synced_at,
    last_sync_error, sync_incident_dismissed_at, updated_at, token_expires_at,
    sources_enabled, granted_scopes, crm_resolver_version,
    refresh_token_encrypted, access_token_encrypted
  `)
  .eq("google_email", email)
  .maybeSingle();

if (connErr) {
  console.error(JSON.stringify({ ok: false, reason: "connection_query_failed", error: connErr.message, projectRef }));
  process.exit(1);
}

if (!connection) {
  console.log(JSON.stringify({ ok: false, reason: "connection_not_found", email, projectRef }, null, 2));
  process.exit(0);
}

const hasRefresh = !!connection.refresh_token_encrypted;
const hasAccess = !!connection.access_token_encrypted;
delete connection.refresh_token_encrypted;
delete connection.access_token_encrypted;

const { data: runs } = await sb
  .from("google_import_runs")
  .select(`
    id, status, progress_stage, run_type, sync_mode, core_sync_status, enrichment_status,
    recovery_status, action_required, trigger_run_id, retry_task_run_id, correlation_id,
    last_heartbeat_at, started_at, completed_at, failed_at, cancelled_at, created_at, updated_at,
    error_code, error, retry_count, next_retry_at, last_reconciled_at, last_reconciliation_outcome,
    processor_version, workflow_version, counts, source_progress
  `)
  .eq("connection_id", connection.id)
  .order("created_at", { ascending: false })
  .limit(12);

const { data: syncStates } = await sb
  .from("google_sync_states")
  .select("source, resource_key, sync_token, history_id, initial_sync_completed, last_successful_sync_at, last_attempted_sync_at, last_error, committed_history_id")
  .eq("connection_id", connection.id);

const { data: leases } = await sb
  .from("google_sync_leases")
  .select("lease_key, sync_type, run_id, status, expires_at, acquired_at, updated_at")
  .eq("connection_id", connection.id)
  .order("updated_at", { ascending: false })
  .limit(10);

const { count: peopleCount } = await sb
  .from("crm_people")
  .select("id", { count: "exact", head: true })
  .eq("owner_user_id", connection.user_id);

const { count: companyCount } = await sb
  .from("crm_companies")
  .select("id", { count: "exact", head: true })
  .eq("owner_user_id", connection.user_id);

const { count: reviewCount } = await sb
  .from("crm_review_candidates")
  .select("id", { count: "exact", head: true })
  .eq("owner_user_id", connection.user_id)
  .eq("status", "pending");

const now = Date.now();
const enrichedRuns = (runs ?? []).map((run) => {
  const hb = run.last_heartbeat_at ? new Date(run.last_heartbeat_at).getTime() : null;
  return {
    ...run,
    error: run.error ? String(run.error).slice(0, 200) : null,
    heartbeat_age_ms: hb == null ? null : now - hb,
    heartbeat_stale_25m: hb == null ? true : now - hb > 25 * 60 * 1000,
    is_active_status: ["queued", "starting", "running", "waiting"].includes(run.status),
  };
});

const activeRuns = enrichedRuns.filter((r) => r.is_active_status);

console.log(JSON.stringify({
  ok: true,
  projectRef,
  inspected_at: new Date().toISOString(),
  connection: {
    ...connection,
    has_refresh_token: hasRefresh,
    has_access_token: hasAccess,
    scope_count: (connection.granted_scopes ?? []).length,
  },
  crm_counts: {
    people: peopleCount,
    companies: companyCount,
    pending_review: reviewCount,
  },
  active_run_count: activeRuns.length,
  active_runs: activeRuns,
  latest_runs: enrichedRuns,
  sync_states: (syncStates ?? []).map((s) => ({
    ...s,
    has_sync_token: !!s.sync_token,
    has_history_id: !!s.history_id,
    sync_token: undefined,
    history_id: undefined,
    committed_history_id: s.committed_history_id ? "[present]" : null,
  })),
  leases: leases ?? [],
}, null, 2));
