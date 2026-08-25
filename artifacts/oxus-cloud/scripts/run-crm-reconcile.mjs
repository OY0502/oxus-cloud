/**
 * Invoke CRM import quality reconciliation via edge function.
 * Uses service role or GOOGLE_SYNC_WORKER_SECRET (same as Trigger.dev).
 * Usage: node scripts/run-crm-reconcile.mjs [--dry-run]
 */
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnv();

const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();
const dryRun = process.argv.includes("--dry-run");
const runKey = process.argv.find((a) => a.startsWith("--run-key="))?.split("=")[1]
  ?? `crm-reconcile-manual-${new Date().toISOString().slice(0, 19)}`;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const authCredential = workerSecret || key;
const headers = {
  Authorization: `Bearer ${authCredential}`,
  apikey: key,
  "Content-Type": "application/json",
};
if (workerSecret) headers["x-oxus-internal-secret"] = workerSecret;

const resp = await fetch(`${url}/functions/v1/crm-reconcile-import-quality`, {
  method: "POST",
  headers,
  body: JSON.stringify({ dry_run: dryRun, run_key: runKey }),
});

const text = await resp.text();
if (!resp.ok) {
  console.error(`Reconciliation failed (${resp.status}):`, text.slice(0, 800));
  process.exit(1);
}

const result = JSON.parse(text);
console.log(JSON.stringify({ run_key: runKey, report: result.report ?? result }, null, 2));
