import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { executeAgentWorkflow } from "../_shared/agent/orchestration.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";

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

function err(message: string, status: number, details?: string) {
  return json({ error: message, details }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405);
  if (!(await isServiceRoleRequest(req))) return err("Service role required.", 401);

  try {
    const body = await req.json() as {
      workflow_id: string;
      project_id: string;
      user_id: string;
      step_overrides?: Record<string, Record<string, unknown>>;
      trigger_run_id?: string;
    };

    console.info("[execute-agent-workflow-worker] start", {
      workflow_id: body.workflow_id,
      project_id: body.project_id,
    });

    const admin = getServiceRoleSupabase();
    const result = await executeAgentWorkflow({
      admin,
      workflowId: body.workflow_id,
      projectId: body.project_id,
      userId: body.user_id,
      stepOverrides: body.step_overrides,
    });

    if (body.trigger_run_id) {
      await admin
        .from("agent_tool_runs")
        .update({ trigger_run_id: body.trigger_run_id })
        .eq("workflow_id", body.workflow_id)
        .eq("project_id", body.project_id);
    }

    console.info("[execute-agent-workflow-worker] completed", {
      workflow_id: body.workflow_id,
      steps_completed: result.steps_completed,
    });

    return json({ ...result, status: "succeeded" });
  } catch (e) {
    const message = (e as Error).message;
    console.error("[execute-agent-workflow-worker] failed", message);
    return err("Workflow worker failed.", 500, message);
  }
});
