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
if (!url || !key) {
  console.error("missing env");
  process.exit(1);
}

const resp = await fetch(
  `${url}/rest/v1/google_import_runs?select=id,status,progress_stage,error_code,error,connection_id,trigger_run_id&order=created_at.desc&limit=8`,
  {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  },
);
const data = await resp.json();
if (!resp.ok) {
  console.error("DB_ERROR", data);
  process.exit(1);
}

for (const row of data ?? []) {
  console.log(JSON.stringify({
    id: row.id,
    status: row.status,
    stage: row.progress_stage,
    code: row.error_code,
    error: row.error?.slice(0, 100),
    trigger_run_id: row.trigger_run_id,
  }));
}
