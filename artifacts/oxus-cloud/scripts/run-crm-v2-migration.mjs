/**
 * Production CRM v2 migration runner (fetch-only, no Supabase client). Does not print secrets.
 */
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  for (const file of [".env", "supabase/functions/.env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetEmail = process.argv[2] || "hello@oxus.agency";

if (!url || !key) {
  console.error("MISSING_ENV: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

async function rest(path, options = {}) {
  const resp = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer ?? "return=representation",
      ...(options.headers ?? {}),
    },
  });
  const text = await resp.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!resp.ok) throw new Error(typeof body === "object" ? JSON.stringify(body) : String(body));
  return body;
}

async function invokeWorker(body) {
  const resp = await fetch(`${url}/functions/v1/crm-resolver-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let result;
  try { result = JSON.parse(text); } catch { result = { error: text }; }
  if (!resp.ok) throw new Error(result.error || text.slice(0, 500));
  return result;
}

const connections = await rest(`user_google_connections?google_email=ilike.${encodeURIComponent(targetEmail)}&select=id,user_id,google_email,crm_resolver_version`);
const conn = connections?.[0];
if (!conn) {
  console.error("CONNECTION_NOT_FOUND");
  process.exit(1);
}

console.log("Resolved connection:", {
  connection_id: conn.id,
  user_id: conn.user_id,
  google_email: conn.google_email,
  crm_resolver_version: conn.crm_resolver_version,
});

await rest(`user_google_connections?id=eq.${conn.id}`, {
  method: "PATCH",
  body: JSON.stringify({ crm_resolver_version: 2 }),
  prefer: "return=minimal",
});

const result = await invokeWorker({ action: "migrate_account", connection_id: conn.id });
const runId = result.runId;

for (let i = 0; i < 250; i++) {
  const stageResult = await invokeWorker({ action: "run_stage", run_id: runId });
  process.stderr.write(`stage ${i + 1}: ${stageResult.stage} done=${stageResult.done}\n`);
  if (stageResult.done) break;
}

let calendarAudit = null;
try {
  calendarAudit = await invokeWorker({ action: "calendar_audit", connection_id: conn.id });
} catch { /* optional */ }

const finalConn = await rest(`user_google_connections?id=eq.${conn.id}&select=crm_resolver_version,crm_migrated_at,crm_migration_run_id`);

console.log(JSON.stringify({
  migration_run_id: runId,
  report: result.report,
  calendar_audit: calendarAudit,
  connection: finalConn?.[0] ?? null,
}, null, 2));
