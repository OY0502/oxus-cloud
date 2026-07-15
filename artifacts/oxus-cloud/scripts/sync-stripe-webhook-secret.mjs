/**
 * Rotate the live Stripe webhook signing secret and sync it to Supabase.
 * Does not print secret values.
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

const projectRef = "xyphlqyujifneqqtzmto";
const url = process.env.SUPABASE_URL?.trim() || `https://${projectRef}.supabase.co`;

let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!serviceKey) {
  const raw = execSync(`npx supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const keys = JSON.parse(raw);
  serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
}

if (!serviceKey) {
  console.error("Could not resolve service role key.");
  process.exit(1);
}

const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();
const headers = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
  "Content-Type": "application/json",
};
if (workerSecret) headers["x-oxus-internal-secret"] = workerSecret;

const rotateResp = await fetch(`${url}/functions/v1/stripe-rotate-webhook-secret`, {
  method: "POST",
  headers,
  body: "{}",
});

const rotateText = await rotateResp.text();
if (!rotateResp.ok) {
  console.error(`Secret rotation failed (${rotateResp.status}):`, rotateText.slice(0, 800));
  process.exit(1);
}

const rotateResult = JSON.parse(rotateText);
if (!rotateResult.webhook_secret) {
  console.error("Rotation response missing webhook_secret.");
  process.exit(1);
}

execSync(
  `npx supabase secrets set STRIPE_WEBHOOK_SECRET="${rotateResult.webhook_secret}" --project-ref ${projectRef}`,
  { stdio: ["ignore", "ignore", "inherit"] },
);

console.log(JSON.stringify({
  ok: true,
  endpoint_id: rotateResult.endpoint_id,
  endpoint_url: rotateResult.endpoint_url,
  endpoint_status: rotateResult.endpoint_status,
  secret_synced: true,
}, null, 2));
