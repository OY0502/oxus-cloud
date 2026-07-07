import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { executeConfirmedToolRun } from "../_shared/agent/orchestration.ts";
import { mergeAndValidateClickupDocPayload } from "../_shared/agent/clickupDocTool.ts";
import { isConfirmableAgentToolRun, isStaleAgentToolRun } from "../_shared/agent/toolRunUtils.ts";
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

const TRIGGER_TASK_MAP: Record<string, string> = {
  create_clickup_task: "create-clickup-task-from-agent",
  create_clickup_doc: "create-clickup-doc-from-agent",
  link_clickup_doc_to_task: "link-clickup-doc-to-task",
  sync_clickup_docs: "sync-clickup-project-docs",
  sync_clickup_hierarchy: "sync-clickup-hierarchy",
  sync_slack_channel: "sync-slack-project-channel",
  create_clickup_folder: "create-clickup-task-from-agent",
  rename_clickup_folder: "create-clickup-task-from-agent",
  archive_clickup_folder: "create-clickup-task-from-agent",
  create_clickup_list: "create-clickup-task-from-agent",
  rename_clickup_list: "create-clickup-task-from-agent",
  move_clickup_doc: "create-clickup-task-from-agent",
  move_clickup_task: "create-clickup-task-from-agent",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let body: { tool_run_id?: string; input_payload_overrides?: Record<string, unknown>; cancel?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const toolRunId = body.tool_run_id?.trim();
    if (!toolRunId) return err("tool_run_id is required.", 400, "INVALID_INPUT");

    const admin = getServiceRoleSupabase();

    if (body.cancel === true) {
      await admin
        .from("agent_tool_runs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", toolRunId)
        .eq("user_id", auth.userId);
      return json({ tool_run_id: toolRunId, status: "cancelled" });
    }

    const { data: toolRun } = await admin
      .from("agent_tool_runs")
      .select("tool_name, project_id, status, input_payload, user_id, started_at, trigger_run_id")
      .eq("id", toolRunId)
      .single();

    if (!toolRun) return err("Tool run not found.", 404, "NOT_FOUND");
    if (toolRun.user_id && toolRun.user_id !== auth.userId) {
      return err("Not authorized to confirm this tool run.", 403, "AUTH_FORBIDDEN");
    }

    if (!isConfirmableAgentToolRun(toolRun)) {
      return err(`Tool run is not confirmable (status=${toolRun.status}).`, 409, "INVALID_STATUS");
    }

    let mergedPayload = {
      ...((toolRun.input_payload ?? {}) as Record<string, unknown>),
      ...(body.input_payload_overrides ?? {}),
    };

    if (toolRun.tool_name === "create_clickup_doc") {
      mergedPayload = mergeAndValidateClickupDocPayload(
        (toolRun.input_payload ?? {}) as Record<string, unknown>,
        body.input_payload_overrides,
      );
    }

    const staleRunning = isStaleAgentToolRun(toolRun);

    if (isTriggerDevConfigured() && toolRun.tool_name && !staleRunning) {
      const taskId = TRIGGER_TASK_MAP[toolRun.tool_name] ?? "create-clickup-task-from-agent";
      try {
        const triggered = await triggerDevTask(taskId, {
          tool_run_id: toolRunId,
          user_id: auth.userId,
          project_id: toolRun.project_id,
          input_payload_overrides: body.input_payload_overrides ?? {},
        });
        if (triggered?.id) {
          await admin
            .from("agent_tool_runs")
            .update({
              status: "running",
              trigger_run_id: triggered.id,
              confirmed_at: new Date().toISOString(),
              input_payload: mergedPayload,
              started_at: new Date().toISOString(),
              error_message: null,
              completed_at: null,
            })
            .eq("id", toolRunId);
          return json({
            tool_run_id: toolRunId,
            status: "running",
            trigger_run_id: triggered.id,
            trigger_enabled: true,
            fallback_used: false,
            async: true,
          });
        }
        throw new Error("Trigger.dev response missing run id.");
      } catch (e) {
        const triggerError = (e as Error).message;
        console.error("[confirm-agent-tool-run] Trigger.dev failed:", triggerError);
        await admin
          .from("agent_tool_runs")
          .update({
            status: "failed",
            error_message: `Trigger.dev trigger failed: ${triggerError.slice(0, 500)}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", toolRunId);
        return err(
          "Trigger.dev is configured but tool execution could not be queued.",
          502,
          "TRIGGER_TRIGGER_FAILED",
          triggerError,
        );
      }
    }

    if (isTriggerDevConfigured()) {
      return err(
        "Trigger.dev is configured; synchronous tool execution is disabled.",
        503,
        "TRIGGER_REQUIRED",
      );
    }

    const { result, tool_name } = await executeConfirmedToolRun({
      admin,
      toolRunId,
      userId: auth.userId,
      inputOverrides: body.input_payload_overrides,
    });

    return json({ tool_run_id: toolRunId, tool_name, status: "succeeded", result, async: false, fallback_used: true });
  } catch (e) {
    return err("Tool confirmation failed.", 500, "TOOL_CONFIRM_ERROR", (e as Error).message);
  }
});
