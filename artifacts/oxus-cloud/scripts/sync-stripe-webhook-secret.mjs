/**
 * Rotate the live Stripe webhook signing secret and sync it to Supabase.
 * Does not print secret values.
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";

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

function runNpx(args, options = {}) {
  const npxCli = join(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  const command = process.platform === "win32" && existsSync(npxCli)
    ? process.execPath
    : "npx";
  const commandArgs = command === process.execPath ? [npxCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      result.error?.message ||
      result.stderr?.trim() ||
        `npx ${args.join(" ")} failed (${result.status})`,
    );
  }
  return result.stdout ?? "";
}

const projectRef = "xyphlqyujifneqqtzmto";
const url =
  process.env.SUPABASE_URL?.trim() || `https://${projectRef}.supabase.co`;

let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!serviceKey) {
  const raw = runNpx([
    "supabase",
    "projects",
    "api-keys",
    "--project-ref",
    projectRef,
    "-o",
    "json",
  ]);
  const keys = JSON.parse(raw);
  serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
}

if (!serviceKey) {
  console.error("Could not resolve service role key.");
  process.exit(1);
}

const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();
const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
const headers = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
  "Content-Type": "application/json",
};
if (workerSecret) headers["x-oxus-internal-secret"] = workerSecret;

const finalizeIndex = process.argv.indexOf("--finalize");
if (finalizeIndex >= 0) {
  const keepEndpointId = process.argv[finalizeIndex + 1]?.trim();
  if (!keepEndpointId) {
    console.error(
      "Usage: node sync-stripe-webhook-secret.mjs --finalize <endpoint_id>",
    );
    process.exit(1);
  }
  const response = await fetch(
    `${url}/functions/v1/stripe-rotate-webhook-secret`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "finalize",
        keep_endpoint_id: keepEndpointId,
      }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    console.error(
      `Endpoint cleanup failed (${response.status}):`,
      text.slice(0, 800),
    );
    process.exit(1);
  }
  const result = JSON.parse(text);
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint_id: result.endpoint_id,
        endpoint_url: result.endpoint_url,
        removed_endpoint_ids: result.removed_endpoint_ids ?? [],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!previousWebhookSecret) {
  console.error(
    "STRIPE_WEBHOOK_SECRET is required locally for zero-downtime rotation.",
  );
  process.exit(1);
}

const rotateResp = await fetch(
  `${url}/functions/v1/stripe-rotate-webhook-secret`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "prepare" }),
  },
);

const rotateText = await rotateResp.text();
if (!rotateResp.ok) {
  console.error(
    `Secret rotation failed (${rotateResp.status}):`,
    rotateText.slice(0, 800),
  );
  process.exit(1);
}

const rotateResult = JSON.parse(rotateText);
if (!rotateResult.webhook_secret) {
  console.error("Rotation response missing webhook_secret.");
  process.exit(1);
}

runNpx([
  "supabase",
  "secrets",
  "set",
  `STRIPE_WEBHOOK_SECRET=${rotateResult.webhook_secret}`,
  `STRIPE_WEBHOOK_SECRET_PREVIOUS=${previousWebhookSecret}`,
  "--project-ref",
  projectRef,
]);

console.log(
  JSON.stringify(
    {
      ok: true,
      endpoint_id: rotateResult.endpoint_id,
      endpoint_url: rotateResult.endpoint_url,
      endpoint_status: rotateResult.endpoint_status,
      secret_synced: true,
      previous_endpoint_ids_retained: rotateResult.previous_endpoint_ids ?? [],
      finalize_command: `node scripts/sync-stripe-webhook-secret.mjs --finalize ${rotateResult.endpoint_id}`,
    },
    null,
    2,
  ),
);
