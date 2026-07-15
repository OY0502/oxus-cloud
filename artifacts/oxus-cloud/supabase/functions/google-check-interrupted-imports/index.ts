import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { triggerDevTask } from "../_shared/agent/triggerDev.ts";

const RECONCILE_STALE_TASK_ID = "reconcile-stale-google-imports";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await assertSuperAdminUser(req);

    const run = await triggerDevTask(
      RECONCILE_STALE_TASK_ID,
      { reason: "manual_admin_check" },
      { idempotencyKey: `manual:reconcile-stale:${new Date().toISOString().slice(0, 16)}` },
    );

    return json({
      ok: true,
      task_id: RECONCILE_STALE_TASK_ID,
      trigger_run_id: run.id,
      message: "Interrupted import watchdog queued.",
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[google-check-interrupted-imports]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
