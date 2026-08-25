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

const importRunId = process.argv[2];
if (!importRunId) {
  console.error("usage: node scripts/run-google-import-worker.mjs <import_run_id>");
  process.exit(1);
}

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();
const authCredential = workerSecret || key;
const correlationId = crypto.randomUUID();

const resp = await fetch(`${url}/functions/v1/google-sync-worker`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authCredential}`,
    apikey: key,
    ...(workerSecret ? { "x-oxus-internal-secret": workerSecret } : {}),
    "x-correlation-id": correlationId,
  },
  body: JSON.stringify({
    import_run_id: importRunId,
    correlation_id: correlationId,
    trigger_run_id: "manual-test",
  }),
});

const text = await resp.text();
console.log("WORKER_RESULT", resp.status, text.slice(0, 1200));
