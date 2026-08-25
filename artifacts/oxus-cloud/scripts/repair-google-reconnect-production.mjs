/**
 * Production repair for hello@oxus.agency Google reconnect stuck state.
 *
 * Modes:
 *   node scripts/repair-google-reconnect-production.mjs --dry-run
 *   node scripts/repair-google-reconnect-production.mjs --apply
 *
 * Does not print secrets. Preserves CRM records and source checkpoints.
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
      if (!process.env[key]) process.env[key] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnv();

const APPLY = process.argv.includes("--apply");
const email = process.env.GOOGLE_REPAIR_EMAIL || "hello@oxus.agency";

async function getServiceClient() {
  // Prefer linked management API via env if present; otherwise fail clearly.
  let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    // Fallback: read from supabase secrets is not possible; require env.
    console.error(JSON.stringify({
      ok: false,
      reason: "MISSING_SERVICE_ROLE_KEY",
      hint: "Set SUPABASE_SERVICE_ROLE_KEY in the environment for this script.",
    }));
    process.exit(1);
  }
  if (!url) {
    console.error(JSON.stringify({ ok: false, reason: "MISSING_SUPABASE_URL" }));
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function triggerTask(taskId, payload, idempotencyKey) {
  const secret = process.env.TRIGGER_SECRET_KEY;
  if (!secret) throw new Error("TRIGGER_SECRET_KEY missing");
  const api = (process.env.TRIGGER_API_URL || "https://api.trigger.dev").replace(/\/$/, "");
  const resp = await fetch(`${api}/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload, options: { idempotencyKey } }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Trigger.dev dispatch failed (${resp.status}): ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const sb = await getServiceClient();

const { data: connection, error: connErr } = await sb
  .from("user_google_connections")
  .select("id, user_id, google_account_id, google_email, status, connection_generation, last_successful_sync_at, connected_at, updated_at, sources_enabled")
  .eq("google_email", email)
  .maybeSingle();

if (connErr || !connection) {
  console.log(JSON.stringify({ ok: false, reason: "connection_not_found", error: connErr?.message, email }, null, 2));
  process.exit(1);
}

const { data: activeRuns } = await sb
  .from("google_import_runs")
  .select("id, status, progress_stage, run_type, sync_mode, core_sync_status, enrichment_status, recovery_status, trigger_run_id, last_heartbeat_at, retry_count, error_code, connection_generation, created_at")
  .eq("connection_id", connection.id)
  .in("status", ["queued", "starting", "running", "waiting"])
  .order("created_at", { ascending: false });

const { data: syncStates } = await sb
  .from("google_sync_states")
  .select("source, resource_key, initial_sync_completed, sync_token, history_id, last_successful_sync_at")
  .eq("connection_id", connection.id);

const now = new Date();
const dryRun = {
  mode: APPLY ? "apply" : "dry-run",
  inspected_at: now.toISOString(),
  connection: {
    id: connection.id,
    google_email: connection.google_email,
    google_account_id: connection.google_account_id,
    status: connection.status,
    connection_generation: connection.connection_generation ?? 1,
    last_successful_sync_at: connection.last_successful_sync_at,
    connected_at: connection.connected_at,
  },
  active_runs: (activeRuns ?? []).map((r) => ({
    ...r,
    heartbeat_age_ms: r.last_heartbeat_at ? now.getTime() - new Date(r.last_heartbeat_at).getTime() : null,
  })),
  sync_checkpoints: (syncStates ?? []).map((s) => ({
    source: s.source,
    resource_key: s.resource_key,
    initial_sync_completed: s.initial_sync_completed,
    has_sync_token: !!s.sync_token,
    has_history_id: !!s.history_id,
    last_successful_sync_at: s.last_successful_sync_at,
  })),
  proposed: {
    interrupt_run_ids: (activeRuns ?? []).map((r) => r.id),
    bump_generation_to: Number(connection.connection_generation ?? 1) + 1,
    create_incremental: true,
    preserve_crm: true,
    preserve_checkpoints: true,
    enqueue_task: "google-incremental-sync",
  },
};

console.log(JSON.stringify(dryRun, null, 2));

if (!APPLY) {
  console.log(JSON.stringify({ ok: true, dry_run_only: true }));
  process.exit(0);
}

if (connection.status !== "active") {
  console.error(JSON.stringify({ ok: false, reason: "connection_not_active", status: connection.status }));
  process.exit(1);
}

const interrupted = [];
for (const run of activeRuns ?? []) {
  const { data } = await sb.from("google_import_runs").update({
    status: "cancelled",
    progress_stage: "failed",
    error_code: "GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT",
    error: "Orphaned Google sync interrupted by production reconnect repair.",
    interrupted_at: now.toISOString(),
    cancelled_at: now.toISOString(),
    completed_at: now.toISOString(),
    recovery_status: "idle",
    action_required: false,
    next_retry_at: null,
    last_heartbeat_at: now.toISOString(),
  }).eq("id", run.id).in("status", ["queued", "starting", "running", "waiting"]).select("id").maybeSingle();
  if (data?.id) interrupted.push(data.id);
}

const nextGeneration = Number(connection.connection_generation ?? 1) + 1;
await sb.from("user_google_connections").update({
  connection_generation: nextGeneration,
  updated_at: now.toISOString(),
  last_sync_error: null,
}).eq("id", connection.id);

await sb.from("google_sync_leases")
  .update({ status: "expired", updated_at: now.toISOString() })
  .eq("connection_id", connection.id)
  .eq("status", "active");

const sourcesEnabled = connection.sources_enabled ?? { contacts: true, calendar: true, gmail: true };
const sources = [
  ...(sourcesEnabled.contacts !== false ? ["contacts"] : []),
  ...(sourcesEnabled.calendar !== false ? ["calendar"] : []),
  ...(sourcesEnabled.gmail ? ["gmail"] : []),
];

const operationIdentity = `google:${connection.id}:${connection.google_account_id}:generation:${nextGeneration}:incremental:repair`;
const correlationId = crypto.randomUUID();

const { data: importRun, error: insertErr } = await sb.from("google_import_runs").insert({
  connection_id: connection.id,
  owner_user_id: connection.user_id,
  run_type: "incremental",
  status: "queued",
  progress_stage: "queued",
  sources,
  lookback_months: 12,
  settings: { repair: "reconnect_orphan", reconnect_sync_mode: "incremental_sync" },
  correlation_id: correlationId,
  sync_mode: "incremental",
  processor_version: 2,
  workflow_version: 2,
  core_sync_status: "pending",
  enrichment_status: "pending",
  connection_generation: nextGeneration,
  operation_identity: operationIdentity,
  dispatch_status: "queued_pending_dispatch",
  last_heartbeat_at: now.toISOString(),
}).select("*").single();

if (insertErr || !importRun) {
  console.error(JSON.stringify({ ok: false, reason: "insert_failed", error: insertErr?.message }));
  process.exit(1);
}

let triggerRunId = null;
try {
  const triggered = await triggerTask("google-incremental-sync", {
    import_run_id: importRun.id,
    connection_id: connection.id,
    user_id: connection.user_id,
    correlation_id: correlationId,
    connection_generation: nextGeneration,
  }, operationIdentity);
  triggerRunId = triggered.id ?? triggered.runId ?? triggered.run?.id ?? null;
  await sb.from("google_import_runs").update({
    trigger_run_id: triggerRunId,
    dispatch_status: "dispatched",
    status: "starting",
    progress_stage: "queued",
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", importRun.id);
} catch (e) {
  await sb.from("google_import_runs").update({
    status: "failed",
    progress_stage: "failed",
    error_code: "GOOGLE_SYNC_DISPATCH_FAILED",
    error: String(e.message ?? e).slice(0, 300),
    dispatch_status: "dispatch_failed",
    failed_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).eq("id", importRun.id);
  console.error(JSON.stringify({ ok: false, reason: "dispatch_failed", error: String(e.message ?? e) }));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  applied: true,
  interrupted_run_ids: interrupted,
  connection_generation: nextGeneration,
  import_run_id: importRun.id,
  trigger_run_id: triggerRunId,
  operation_identity: operationIdentity,
  crm_preserved: true,
  checkpoints_preserved: true,
}, null, 2));
