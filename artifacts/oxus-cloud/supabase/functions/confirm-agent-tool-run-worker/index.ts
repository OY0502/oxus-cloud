import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { executeConfirmedToolRun } from "../_shared/agent/orchestration.ts";
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
      tool_run_id: string;
      user_id: string;
      input_payload_overrides?: Record<string, unknown>;
    };

    const admin = getServiceRoleSupabase();
    const { result, tool_name } = await executeConfirmedToolRun({
      admin,
      toolRunId: body.tool_run_id,
      userId: body.user_id,
      inputOverrides: body.input_payload_overrides,
    });

    return json({ tool_run_id: body.tool_run_id, tool_name, status: "succeeded", result });
  } catch (e) {
    return err("Worker failed.", 500, (e as Error).message);
  }
});
