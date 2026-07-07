import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { runProjectAgent } from "../_shared/agent/orchestration.ts";
import type { AgentMode } from "../_shared/agent/types.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!(await isServiceRoleRequest(req))) return json({ error: "Service role required." }, 401);

  const admin = getServiceRoleSupabase();
  let body: {
    project_id: string;
    user_id: string;
    agent_run_id: string;
    input_text?: string;
    uploaded_file_ids?: string[];
    mode?: AgentMode;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  console.info("[project-agent-run-worker] start", {
    agent_run_id: body.agent_run_id,
    project_id: body.project_id,
    runtime: "trigger.dev",
  });

  await admin
    .from("project_agent_runs")
    .update({ status: "running" })
    .eq("id", body.agent_run_id);

  try {
    const result = await runProjectAgent({
      admin,
      input: body,
      runtime: "trigger.dev",
    });
    console.info("[project-agent-run-worker] completed", {
      agent_run_id: body.agent_run_id,
      status: result.status,
    });
    return json(result);
  } catch (e) {
    const message = (e as Error).message;
    console.error("[project-agent-run-worker] failed", { agent_run_id: body.agent_run_id, message });
    await admin
      .from("project_agent_runs")
      .update({
        status: "failed",
        result_summary: message.slice(0, 500),
        completed_at: new Date().toISOString(),
        raw_response: { error: message },
      })
      .eq("id", body.agent_run_id);
    return json({ error: message }, 500);
  }
});
