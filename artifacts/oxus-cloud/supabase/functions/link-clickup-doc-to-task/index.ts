import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { executeLinkClickupDocToTaskFromToolRun } from "../_shared/agent/executeTools.ts";
import { getAuthenticatedUser } from "../_shared/slack-auth.ts";
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

  try {
    const body = await req.json() as {
      project_id?: string;
      user_id?: string;
      tool_run_id?: string;
      input_payload_overrides?: Record<string, unknown>;
    };

    const admin = getServiceRoleSupabase();
    const serviceRole = await isServiceRoleRequest(req);
    let userId = body.user_id?.trim();

    if (!serviceRole) {
      const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
      if (!auth) return err("Authentication required.", 401);
      userId = auth.userId;
    }

    const projectId = body.project_id?.trim();
    if (!projectId || !userId) return err("project_id and user_id are required.", 400);

    let payload = body.input_payload_overrides ?? {};
    if (body.tool_run_id) {
      const { data: toolRun } = await admin
        .from("agent_tool_runs")
        .select("input_payload, project_id")
        .eq("id", body.tool_run_id)
        .single();
      if (toolRun) {
        payload = { ...(toolRun.input_payload as Record<string, unknown>), ...payload };
      }
    }

    const result = await executeLinkClickupDocToTaskFromToolRun({
      admin,
      projectId,
      userId,
      payload: { ...payload, project_id: projectId },
    });

    if (body.tool_run_id) {
      await admin
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          result_payload: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", body.tool_run_id);
    }

    return json(result);
  } catch (e) {
    return err("Link doc to task failed.", 500, (e as Error).message);
  }
});
