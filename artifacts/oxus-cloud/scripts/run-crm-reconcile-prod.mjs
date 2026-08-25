/**
 * Run CRM reconciliation using Supabase CLI-linked credentials.
 * Does not print secrets.
 */
import { execSync } from "child_process";
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

const runKey = process.argv.find((a) => a.startsWith("--run-key="))?.split("=")[1]
  ?? `crm-reconcile-prod-${new Date().toISOString().slice(0, 10)}`;
const dryRun = process.argv.includes("--dry-run");

let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET;

if (!serviceKey) {
  try {
    const raw = execSync("npx supabase projects api-keys --project-ref xyphlqyujifneqqtzmto -o json", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const keys = JSON.parse(raw);
    const svc = keys.find((k) => k.name === "service_role" || k.description?.toLowerCase().includes("service"));
    if (svc?.api_key) serviceKey = svc.api_key;
  } catch {
    // fall through
  }
}

if (!url) url = "https://xyphlqyujifneqqtzmto.supabase.co";
if (!serviceKey) {
  console.error("Could not resolve service role key. Set SUPABASE_SERVICE_ROLE_KEY or authenticate Supabase CLI.");
  process.exit(1);
}

const authCredential = workerSecret || serviceKey;
const headers = {
  Authorization: `Bearer ${authCredential}`,
  apikey: serviceKey,
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
  console.error(`Reconciliation failed (${resp.status}):`, text.slice(0, 1200));
  process.exit(1);
}

const result = JSON.parse(text);
const report = result.report ?? result;
console.log(JSON.stringify({ ok: true, run_key: runKey, before: report.before, after: report.after, summary: {
  companies_corrected: report.companies_corrected,
  people_corrected: report.people_corrected,
  suppressed: report.suppressed,
  moved_to_review: report.moved_to_review,
  relationships_reclassified: report.relationships_reclassified,
  primary_contacts_updated: report.primary_contacts_updated,
  primary_contacts_removed: report.primary_contacts_removed,
  names_corrected: report.names_corrected,
  duplicates_merged: report.duplicates_merged,
  interactions_rebuilt: report.interactions_rebuilt,
  logos_queued: report.logos_queued,
  manual_preserved: report.manual_preserved,
  examples: report.examples?.slice(0, 10),
}}, null, 2));
