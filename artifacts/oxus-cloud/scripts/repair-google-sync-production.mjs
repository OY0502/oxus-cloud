/**
 * Production repair for stuck Google import runs (service role). Does not print secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
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
  console.error("MISSING_ENV: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: connection } = await sb
  .from("user_google_connections")
  .select("id, google_email, last_successful_sync_at, calendar_last_synced_at")
  .eq("google_email", "hello@oxus.agency")
  .maybeSingle();

if (!connection) {
  console.log(JSON.stringify({ ok: false, reason: "connection_not_found" }));
  process.exit(0);
}

const { data: activeRuns } = await sb
  .from("google_import_runs")
  .select("id, status, progress_stage, core_sync_status, enrichment_status, last_heartbeat_at, created_at")
  .eq("connection_id", connection.id)
  .in("status", ["queued", "starting", "running", "waiting"])
  .order("created_at", { ascending: false });

const now = new Date().toISOString();
const repaired = [];

for (const run of activeRuns ?? []) {
  if (run.core_sync_status === "complete" && run.enrichment_status !== "running") {
    await sb.from("google_import_runs").update({
      status: "completed",
      progress_stage: "completed",
      completed_at: now,
      action_required: false,
      recovery_status: "idle",
      error: null,
      error_code: null,
      last_heartbeat_at: now,
    }).eq("id", run.id);
    repaired.push(run.id);
  }
}

await sb.from("google_sync_leases")
  .update({ status: "expired", updated_at: now })
  .eq("connection_id", connection.id)
  .eq("status", "active");

const { data: latest } = await sb
  .from("google_import_runs")
  .select("id, status, progress_stage, core_sync_status, enrichment_status, last_heartbeat_at, completed_at")
  .eq("connection_id", connection.id)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

console.log(JSON.stringify({
  ok: true,
  connection_id: connection.id,
  google_email: connection.google_email,
  repaired_run_ids: repaired,
  latest_import: latest,
  calendar_last_synced_at: connection.calendar_last_synced_at ?? connection.last_successful_sync_at,
}, null, 2));
