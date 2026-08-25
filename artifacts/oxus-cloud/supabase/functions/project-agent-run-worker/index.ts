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
    chat?: boolean;
    chat_session_id?: string;
    chat_action?: "clarification_response";
    retry_managed?: boolean;
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
    // Trigger.dev owns retries for queued runs. Do not publish an intermediate
    // attempt as a terminal chat failure: a later attempt may still succeed and
    // replace it, while the browser has already stopped polling.
    if (body.retry_managed) {
      return json({ error: message, retrying: true }, 503);
    }
    await admin
      .from("project_agent_runs")
      .update({
        status: "failed",
        result_summary: message.slice(0, 500),
        completed_at: new Date().toISOString(),
        raw_response: { error: message },
      })
      .eq("id", body.agent_run_id);
    if (body.chat) {
      let failureSessionId = body.chat_session_id;
      if (!failureSessionId) {
        const { data: run } = await admin
          .from("project_agent_runs")
          .select("chat_session_id")
          .eq("id", body.agent_run_id)
          .maybeSingle();
        failureSessionId = typeof run?.chat_session_id === "string" ? run.chat_session_id : undefined;
      }
      const failedMessage = {
        content: "I couldn't complete that request. Please try again.",
        metadata: { status: "failed" },
      };
      const { data: existingMessage } = await admin
        .from("project_chat_messages")
        .select("id")
        .eq("agent_run_id", body.agent_run_id)
        .eq("role", "assistant")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingMessage?.id) {
        await admin.from("project_chat_messages").update(failedMessage).eq("id", existingMessage.id);
      } else if (failureSessionId) {
        await admin.from("project_chat_messages").insert({
          project_id: body.project_id,
          chat_session_id: failureSessionId,
          user_id: null,
          role: "assistant",
          agent_run_id: body.agent_run_id,
          ...failedMessage,
        });
      }
    }
    return json({ error: message }, 500);
  }
});
