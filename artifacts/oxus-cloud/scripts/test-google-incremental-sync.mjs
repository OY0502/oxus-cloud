import { readFileSync, existsSync } from "node:fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

const connResp = await fetch(`${url}/rest/v1/user_google_connections?select=id,user_id,status,sources_enabled,import_settings&status=eq.active&limit=1`, { headers });
const connections = await connResp.json();
const connection = connections?.[0];
if (!connection) {
  console.error("NO_ACTIVE_CONNECTION");
  process.exit(1);
}

const sources = [];
const enabled = connection.sources_enabled ?? {};
if (enabled.contacts !== false) sources.push("contacts");
if (enabled.calendar !== false) sources.push("calendar");
if (enabled.gmail) sources.push("gmail");

const correlationId = crypto.randomUUID();
const insertResp = await fetch(`${url}/rest/v1/google_import_runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    connection_id: connection.id,
    owner_user_id: connection.user_id,
    run_type: "incremental",
    status: "queued",
    progress_stage: "queued",
    sources,
    lookback_months: connection.import_settings?.lookback_months ?? 12,
    settings: connection.import_settings ?? {},
    correlation_id: correlationId,
  }),
});
const runs = await insertResp.json();
if (!insertResp.ok) {
  console.error("INSERT_FAILED", runs);
  process.exit(1);
}
const importRun = runs[0];
console.log("CREATED_RUN", importRun.id, correlationId);

const authCredential = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim() || key;
const workerResp = await fetch(`${url}/functions/v1/google-sync-worker`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authCredential}`,
    apikey: key,
    "x-correlation-id": correlationId,
  },
  body: JSON.stringify({
    import_run_id: importRun.id,
    correlation_id: correlationId,
    trigger_run_id: "manual-incremental-test",
  }),
});
const workerText = await workerResp.text();
console.log("WORKER", workerResp.status, workerText.slice(0, 1500));

const statusResp = await fetch(`${url}/rest/v1/google_import_runs?id=eq.${importRun.id}&select=id,status,progress_stage,error_code,error,counts`, { headers });
console.log("FINAL", JSON.stringify(await statusResp.json()));
