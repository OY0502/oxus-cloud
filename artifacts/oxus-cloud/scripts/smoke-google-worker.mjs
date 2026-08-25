/**
 * Production-safe smoke test for google-sync-worker auth.
 * Usage: node scripts/smoke-google-worker.mjs
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
 */
import { readFileSync, existsSync } from "node:fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    if (!process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");
const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();

if (!url || !key) {
  console.error("SMOKE_FAIL: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

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
  body: JSON.stringify({ mode: "auth_smoke_test", correlation_id: correlationId }),
});

const text = await resp.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 200) };
}

if (!resp.ok) {
  console.error("SMOKE_FAIL", resp.status, body.code ?? body.error ?? body);
  process.exit(1);
}

console.log("SMOKE_OK", JSON.stringify({
  status: resp.status,
  auth: body.auth,
  environment: body.environment,
  correlation_id: body.correlation_id,
}));
