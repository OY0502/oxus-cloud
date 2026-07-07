import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { executeAgentWorkflow } from "../_shared/agent/orchestration.ts";
import { isWorkflowConfirmable, loadWorkflowToolRuns } from "../_shared/agent/workflow.ts";
import { isTriggerDevConfigured, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { getAuthenticatedUser } from "../_shared/slack-auth.ts";

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
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let body: {
      workflow_id?: string;
      project_id?: string;
      step_overrides?: Record<string, Record<string, unknown>>;
      cancel?: boolean;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const workflowId = body.workflow_id?.trim();
    const projectId = body.project_id?.trim();
    if (!workflowId || !projectId) {
      return err("workflow_id and project_id are required.", 400, "INVALID_INPUT");
    }

    const admin = getServiceRoleSupabase();
    const runs = await loadWorkflowToolRuns({ admin, workflowId, projectId });

    if (body.cancel === true) {
      await admin
        .from("agent_tool_runs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("workflow_id", workflowId)
        .eq("project_id", projectId)
        .eq("user_id", auth.userId);
      return json({ workflow_id: workflowId, status: "cancelled" });
    }

    if (!isWorkflowConfirmable(runs)) {
      return err("Workflow is not ready for confirmation.", 409, "INVALID_STATUS");
    }

    if (isTriggerDevConfigured()) {
      try {
        const triggered = await triggerDevTask("execute-agent-workflow", {
          workflow_id: workflowId,
          project_id: projectId,
          user_id: auth.userId,
          step_overrides: body.step_overrides ?? {},
        });
        if (triggered?.id) {
          await admin
            .from("agent_tool_runs")
            .update({
              status: "running",
              trigger_run_id: triggered.id,
              confirmed_at: new Date().toISOString(),
              started_at: new Date().toISOString(),
            })
            .eq("workflow_id", workflowId)
            .eq("project_id", projectId)
            .in("status", ["needs_confirmation", "pending"]);

          return json({
            workflow_id: workflowId,
            status: "running",
            trigger_run_id: triggered.id,
            trigger_enabled: true,
            async: true,
          });
        }
        throw new Error("Trigger.dev response missing run id.");
      } catch (e) {
        const triggerError = (e as Error).message;
        return err(
          "Trigger.dev is configured but workflow execution could not be queued.",
          502,
          "TRIGGER_TRIGGER_FAILED",
          triggerError,
        );
      }
    }

    const result = await executeAgentWorkflow({
      admin,
      workflowId,
      projectId,
      userId: auth.userId,
      stepOverrides: body.step_overrides,
    });

    return json({ ...result, status: "succeeded", async: false, fallback_used: true });
  } catch (e) {
    return err("Workflow confirmation failed.", 500, "WORKFLOW_CONFIRM_ERROR", (e as Error).message);
  }
});
