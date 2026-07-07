import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  getTriggerDevStatus,
  isTriggerDevConfigured,
  triggerDevTask,
} from "../_shared/agent/triggerDev.ts";
import { isLangfuseEnabled } from "../_shared/agent/langfuse.ts";
import type { AgentMode } from "../_shared/agent/types.ts";
import { getAuthenticatedUser } from "../_shared/slack-auth.ts";

const TASK_ID = "project-agent-run";

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
      project_id?: string;
      input_text?: string;
      uploaded_file_ids?: string[];
      mode?: AgentMode;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    const inputText = body.input_text?.trim() ?? "";
    const uploadedFileIds = body.uploaded_file_ids ?? [];
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");
    if (!inputText && uploadedFileIds.length === 0) {
      return err("input_text or uploaded_file_ids is required.", 400, "INVALID_INPUT");
    }

    const triggerStatus = getTriggerDevStatus();
    console.info("[project-agent-run] trigger status", triggerStatus);

    const admin = getServiceRoleSupabase();
    const inputSummary = inputText.slice(0, 500);

    const { data: agentRun, error: runErr } = await admin
      .from("project_agent_runs")
      .insert({
        project_id: projectId,
        user_id: auth.userId,
        input_summary: inputSummary,
        status: "running",
        diagnostics: {
          trigger_status: triggerStatus,
          langfuse_enabled: isLangfuseEnabled(),
          runtime: "edge-entrypoint",
        },
      })
      .select("*")
      .single();
    if (runErr || !agentRun) return err("Failed to create agent run.", 500, "DB_ERROR", runErr?.message);

    const payload = {
      project_id: projectId,
      user_id: auth.userId,
      agent_run_id: agentRun.id,
      input_text: inputText,
      uploaded_file_ids: uploadedFileIds,
      mode: body.mode ?? "auto",
    };

    if (isTriggerDevConfigured()) {
      try {
        console.info("[project-agent-run] attempting Trigger.dev trigger", {
          task_id: TASK_ID,
          agent_run_id: agentRun.id,
        });
        const triggered = await triggerDevTask(TASK_ID, payload, {
          idempotencyKey: agentRun.id,
        });

        await admin
          .from("project_agent_runs")
          .update({
            trigger_run_id: triggered.id,
            status: "running",
            diagnostics: {
              trigger_status: triggerStatus,
              trigger_enabled: true,
              fallback_used: false,
              task_id: TASK_ID,
              langfuse_enabled: isLangfuseEnabled(),
              runtime: "trigger.dev",
            },
          })
          .eq("id", agentRun.id);

        return json({
          agent_run_id: agentRun.id,
          status: "running",
          trigger_enabled: true,
          trigger_run_id: triggered.id,
          fallback_used: false,
          async: true,
          message: "Agent run queued via Trigger.dev.",
        });
      } catch (e) {
        const triggerError = (e as Error).message;
        console.error("[project-agent-run] Trigger.dev trigger failed", triggerError);

        await admin
          .from("project_agent_runs")
          .update({
            status: "failed",
            result_summary: `Trigger.dev trigger failed: ${triggerError.slice(0, 400)}`,
            completed_at: new Date().toISOString(),
            diagnostics: {
              trigger_status: triggerStatus,
              trigger_enabled: true,
              fallback_used: false,
              trigger_error: triggerError.slice(0, 500),
              langfuse_enabled: isLangfuseEnabled(),
              runtime: "trigger.dev-error",
            },
          })
          .eq("id", agentRun.id);

        return err(
          "Trigger.dev is configured but the agent run could not be queued.",
          502,
          "TRIGGER_TRIGGER_FAILED",
          triggerError,
        );
      }
    }

    console.warn("[project-agent-run] Trigger.dev not configured — synchronous fallback");
    const warning = triggerStatus.secret_key_present
      ? "Trigger.dev client not ready."
      : "TRIGGER_SECRET_KEY is not set in Supabase secrets. Set it with: npx supabase secrets set TRIGGER_SECRET_KEY=tr_dev_...";

    const { runProjectAgent } = await import("../_shared/agent/orchestration.ts");

    await admin
      .from("project_agent_runs")
      .update({
        diagnostics: {
          trigger_status: triggerStatus,
          trigger_enabled: false,
          fallback_used: true,
          langfuse_enabled: isLangfuseEnabled(),
          runtime: "edge-sync-fallback",
        },
      })
      .eq("id", agentRun.id);

    const result = await runProjectAgent({ admin, input: payload, runtime: "edge-sync-fallback" });
    return json({
      agent_run_id: agentRun.id,
      status: result.status,
      result_summary: result.result_summary,
      answer: result.plan.answer,
      clarification_questions: result.plan.clarification_questions ?? [],
      tool_run_ids: result.tool_run_ids,
      created_task_ids: result.created_task_ids,
      created_source_ids: result.created_source_ids,
      trigger_enabled: false,
      trigger_run_id: null,
      fallback_used: true,
      warning,
      async: false,
      diagnostics: result.diagnostics,
    });
  } catch (e) {
    console.error("[project-agent-run] unexpected error", (e as Error).message);
    return err("Project agent run failed.", 500, "AGENT_RUN_ERROR", (e as Error).message);
  }
});
