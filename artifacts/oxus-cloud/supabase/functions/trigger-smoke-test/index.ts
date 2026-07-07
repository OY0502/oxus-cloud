import { getTriggerDevStatus, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { getAuthenticatedUser, requireSuperAdmin } from "../_shared/slack-auth.ts";

const TASK_ID = "trigger-smoke-test";

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
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return json({ error: "Authentication required." }, 401);

    const isAdmin = await requireSuperAdmin(auth.userId);
    if (!isAdmin) return json({ error: "Super admin required." }, 403);

    const triggerStatus = getTriggerDevStatus();
    console.info("[trigger-smoke-test] status", triggerStatus);

    if (!triggerStatus.configured) {
      return json({
        ok: false,
        trigger_enabled: false,
        trigger_status: triggerStatus,
        warning: "TRIGGER_SECRET_KEY is not set in Supabase Edge Function secrets.",
      });
    }

    let message = "OXUS Cloud Trigger smoke test";
    try {
      const body = await req.json() as { message?: string };
      if (body.message?.trim()) message = body.message.trim();
    } catch {
      // empty body is fine
    }

    const triggered = await triggerDevTask(TASK_ID, { message, source: "trigger-smoke-test" });

    return json({
      ok: true,
      trigger_enabled: true,
      trigger_run_id: triggered.id,
      task_id: TASK_ID,
      trigger_status: triggerStatus,
    });
  } catch (e) {
    return json({
      ok: false,
      error: (e as Error).message,
      trigger_status: getTriggerDevStatus(),
    }, 500);
  }
});
