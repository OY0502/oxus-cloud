import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  // OXUS Cloud project ref (dashboard slug oxus-cloud_GIK is not accepted by the v4 API)
  project: "proj_obirqjqllcyukpslcckr",
  runtime: "node",
  logLevel: "info",
  maxDuration: 600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      ffmpeg(),
      syncEnvVars(async () => {
        const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
        const workerSecret = process.env.GOOGLE_SYNC_WORKER_SECRET?.trim();
        if (!url || !serviceKey) {
          console.warn(
            "[trigger.config] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY during deploy. " +
              "Trigger tasks will fail until these are synced. " +
              "Re-run deploy with both set in the shell environment.",
          );
          return undefined;
        }
        const vars: Record<string, string> = {
          SUPABASE_URL: url,
          SUPABASE_SERVICE_ROLE_KEY: serviceKey,
        };
        if (workerSecret) vars.GOOGLE_SYNC_WORKER_SECRET = workerSecret;
        const triggerSecret = process.env.TRIGGER_SECRET_KEY?.trim();
        if (triggerSecret) vars.TRIGGER_SECRET_KEY = triggerSecret;
        return vars;
      }),
    ],
  },
});
