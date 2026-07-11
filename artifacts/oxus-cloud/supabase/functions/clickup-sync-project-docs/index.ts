import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { executeSyncClickupDocsFromToolRun } from "../_shared/agent/executeTools.ts";
import {
  getTriggerKeyEnvironment,
  shouldQueueTriggerDevTasks,
  triggerDevEnvironmentWarning,
  triggerDevTask,
} from "../_shared/agent/triggerDev.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";
import {
  assertInternalOxusUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

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

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const serviceRole = await isServiceRoleRequest(req);

    let body: {
      project_id?: string;
      user_id?: string;
      tool_run_id?: string;
      sync_all_workspace_docs?: boolean;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");

    let userId = body.user_id?.trim();
    if (!serviceRole) {
      let auth;
      try {
        auth = await assertInternalOxusUser(req);
      } catch (e) {
        if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
        throw e;
      }
      userId = auth.userId;
    } else if (!userId) {
      return err("user_id is required for service-role invocations.", 400, "INVALID_INPUT");
    }

    const queueViaTrigger = !serviceRole && shouldQueueTriggerDevTasks();
    const triggerWarning = triggerDevEnvironmentWarning();

    if (queueViaTrigger) {
      try {
        const triggered = await triggerDevTask("sync-clickup-project-docs", {
          project_id: projectId,
          user_id: userId,
          tool_run_id: body.tool_run_id,
          sync_all_workspace_docs: body.sync_all_workspace_docs === true,
        });
        if (triggered?.id) {
          return json({
            trigger_run_id: triggered.id,
            trigger_environment: getTriggerKeyEnvironment(),
            async: true,
            message: "ClickUp docs sync queued via Trigger.dev.",
          });
        }
      } catch (e) {
        console.warn("[clickup-sync-project-docs] Trigger.dev failed:", (e as Error).message);
      }
    }

    const admin = getServiceRoleSupabase();
    const result = await executeSyncClickupDocsFromToolRun({
      admin,
      projectId,
      userId: userId!,
      syncAllWorkspaceDocs: body.sync_all_workspace_docs === true,
      runInlinePostProcessing: !shouldQueueTriggerDevTasks(),
    });

    if (body.tool_run_id) {
      await admin
        .from("agent_tool_runs")
        .update({ status: "succeeded", result_payload: result, completed_at: new Date().toISOString() })
        .eq("id", body.tool_run_id);
    }

    return json({
      ...result,
      async: false,
      trigger_environment: getTriggerKeyEnvironment(),
      fallback_used: !!triggerWarning,
      warning: triggerWarning ?? undefined,
    });
  } catch (e) {
    return err("ClickUp docs sync failed.", 500, "CLICKUP_DOCS_SYNC_ERROR", (e as Error).message);
  }
});
