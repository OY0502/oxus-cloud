/** Security check: unauthenticated worker call must return 401 */
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
if (!url) {
  console.error("missing SUPABASE_URL");
  process.exit(1);
}

const resp = await fetch(`${url}/functions/v1/google-sync-worker`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "auth_smoke_test" }),
});
const body = await resp.json().catch(() => ({}));
console.log("UNAUTH_TEST", resp.status, body.code ?? body.error ?? "no_body");
process.exit(resp.status === 401 ? 0 : 1);
