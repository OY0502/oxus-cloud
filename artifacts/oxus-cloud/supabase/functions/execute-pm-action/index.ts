import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addClickupTaskComment,
  assignClickupTask,
  insertOxusTimelineEvent,
  setClickupTaskDueDate,
} from "../_shared/clickup.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  loadOxusActorProfile,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ExecutionPayload = {
  assignee_ids?: string[];
  due_date?: string;
  due_date_time?: boolean;
  comment_text?: string;
  selected_clickup_task_ids?: string[];
  selected_ai_proposed_task_ids?: string[];
  resolve_blocker?: boolean;
  resolution_note?: string;
};

type RequestBody = {
  action_item_id?: string;
  execution_payload?: ExecutionPayload;
  retry?: boolean;
};

const ACTION_TYPES = new Set([
  "manual",
  "create_clickup_task",
  "assign_clickup_tasks",
  "update_clickup_deadline",
  "add_clickup_comment",
  "request_access",
  "ask_client_question",
  "review_risk",
  "review_scope",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  if (status >= 500) console.error(`[${code}] ${message}`, details ?? "");
  return json({ error: message, details, code }, status);
}

function getAnonKey(): string | null {
  const key = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (key) return key;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

function payloadTaskIds(actionPayload: Record<string, unknown>, execution: ExecutionPayload): string[] {
  const fromExec = execution.selected_clickup_task_ids ?? [];
  const fromAction = Array.isArray(actionPayload.clickup_task_ids)
    ? actionPayload.clickup_task_ids.filter((id): id is string => typeof id === "string")
    : [];
  return [...new Set([...fromExec, ...fromAction])];
}

async function recordExecution(
  supabase: any,
  args: {
    projectId: string;
    actionItemId: string;
    actionType: string;
    inputPayload: Record<string, unknown>;
    resultPayload: Record<string, unknown>;
    status: "succeeded" | "failed" | "partial";
    errorMessage?: string | null;
    clickupTaskIds: string[];
    createdBy: string;
  },
) {
  const { data, error } = await supabase
    .from("project_pm_action_executions")
    .insert({
      project_id: args.projectId,
      action_item_id: args.actionItemId,
      action_type: args.actionType,
      input_payload: args.inputPayload,
      result_payload: args.resultPayload,
      status: args.status,
      error_message: args.errorMessage ?? null,
      clickup_task_ids: args.clickupTaskIds,
      created_by: args.createdBy,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function markActionItem(
  supabase: any,
  actionItemId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase.from("project_pm_action_items").update(patch).eq("id", actionItemId);
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    if (!supabaseUrl || !anonKey) return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }
    if (!body.action_item_id) return err("action_item_id is required.", 400, "INVALID_INPUT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const { data: actionItem, error: itemErr } = await supabase
      .from("project_pm_action_items")
      .select("*")
      .eq("id", body.action_item_id)
      .single();
    if (itemErr || !actionItem) return err("PM action item not found.", 404, "NOT_FOUND", itemErr?.message);

    const actionType = actionItem.action_type ?? "manual";
    if (!ACTION_TYPES.has(actionType)) {
      return err(`Unsupported action type: ${actionType}`, 400, "INVALID_INPUT");
    }

    if (actionItem.execution_status === "succeeded" && !body.retry) {
      return err("This action was already executed successfully.", 409, "ALREADY_EXECUTED");
    }

    const executionPayload = body.execution_payload ?? {};
    const actionPayload = (actionItem.action_payload ?? {}) as Record<string, unknown>;
    const projectId = actionItem.project_id as string;

    const needsClickup =
      actionType === "assign_clickup_tasks" ||
      actionType === "update_clickup_deadline" ||
      actionType === "add_clickup_comment" ||
      actionType === "create_clickup_task";

    let clickup: Awaited<ReturnType<typeof resolveUserClickupForProject>>["clickup"] | null = null;
    let clickupConnectionUsername: string | null = null;
    if (needsClickup) {
      try {
        const resolved = await resolveUserClickupForProject(userId, projectId);
        clickup = resolved.clickup;
        clickupConnectionUsername = resolved.connection.clickup_username ?? null;
      } catch (e) {
        if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
        throw e;
      }
    }

    const oxusActor = await loadOxusActorProfile(userId);
    const actorName = oxusActor.full_name ?? clickupConnectionUsername;
    const actorEmail = oxusActor.email;

    await markActionItem(supabase, actionItem.id, { execution_status: "running", execution_error: null });

    const { data: projectLink } = await supabase
      .from("project_clickup_links")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    const inputPayload = { execution_payload: executionPayload, action_payload: actionPayload };

    // Manual / review actions — no external API.
    if (actionType === "manual" || actionType === "review_risk" || actionType === "review_scope") {
      const resultPayload = { note: "Marked complete in OXUS Cloud." };
      const execution = await recordExecution(supabase, {
        projectId,
        actionItemId: actionItem.id,
        actionType,
        inputPayload,
        resultPayload,
        status: "succeeded",
        clickupTaskIds: [],
        createdBy: userId,
      });
      await markActionItem(supabase, actionItem.id, {
        execution_status: "succeeded",
        execution_result: resultPayload,
        status: "done",
        completed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
      });
      return json({ execution, action_item_id: actionItem.id, status: "succeeded" });
    }

    if (actionType === "request_access" && executionPayload.resolve_blocker) {
      const resolutionNote =
        typeof executionPayload.resolution_note === "string" ? executionPayload.resolution_note.trim() : "";
      const resource =
        (typeof actionItem.blocker_resource === "string" && actionItem.blocker_resource) ||
        (typeof actionPayload.system_name === "string" && actionPayload.system_name) ||
        "required system";
      const actor =
        (typeof actionItem.blocked_actor_name === "string" && actionItem.blocked_actor_name) || "developer";
      const taskIds = [
        ...payloadTaskIds(actionPayload, executionPayload),
        ...((actionItem.related_clickup_task_ids as string[] | null) ?? []),
      ].filter(Boolean);
      const uniqueTaskIds = [...new Set(taskIds)];
      const resultPayload = { resolved: true, resolution_note: resolutionNote || null };

      const execution = await recordExecution(supabase, {
        projectId,
        actionItemId: actionItem.id,
        actionType,
        inputPayload,
        resultPayload,
        status: "succeeded",
        clickupTaskIds: uniqueTaskIds,
        createdBy: userId,
      });

      await markActionItem(supabase, actionItem.id, {
        execution_status: "succeeded",
        execution_result: resultPayload,
        status: "done",
        completed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        resolution_note: resolutionNote || null,
      });

      let clickupTaskLinkId: string | null = null;
      const clickupTaskId = uniqueTaskIds[0] ?? null;
      if (clickupTaskId) {
        const { data: taskLink } = await supabase
          .from("clickup_task_links")
          .select("id")
          .eq("project_id", projectId)
          .eq("clickup_task_id", clickupTaskId)
          .maybeSingle();
        clickupTaskLinkId = taskLink?.id ?? null;
      }

      await insertOxusTimelineEvent(supabase, {
        projectId,
        clickupTaskLinkId,
        clickupTaskId,
        eventType: "pm_blocker_resolved",
        eventTitle: "Resolved access blocker",
        eventSummary: `${actorName ?? "PM"} marked the access blocker resolved for ${actor} (${resource}).${
          resolutionNote ? ` Note: ${resolutionNote}` : ""
        }`,
        actorName,
        actorEmail,
        rawPayload: {
          action_item_id: actionItem.id,
          blocker_resource: resource,
          blocked_actor_name: actor,
          resolution_note: resolutionNote || null,
          oxus_user_id: userId,
          clickup_username: clickupConnectionUsername,
        },
      });

      return json({ execution, action_item_id: actionItem.id, status: "succeeded" });
    }

    if (actionType === "request_access") {
      return err(
        "Use resolve_blocker to mark access blockers resolved after handling them.",
        400,
        "INVALID_INPUT",
      );
    }

    if (actionType === "ask_client_question") {
      return err(
        "Copy the client question locally, then mark the action done when sent.",
        400,
        "INVALID_INPUT",
      );
    }

    if (actionType === "create_clickup_task") {
      const aiIds = [
        ...(executionPayload.selected_ai_proposed_task_ids ?? []),
        ...(Array.isArray(actionPayload.ai_proposed_task_ids)
          ? actionPayload.ai_proposed_task_ids.filter((id): id is string => typeof id === "string")
          : []),
      ];
      const uniqueAiIds = [...new Set(aiIds)];
      if (uniqueAiIds.length === 0) {
        await markActionItem(supabase, actionItem.id, {
          execution_status: "failed",
          execution_error: "Create task from freeform PM action is not implemented yet.",
        });
        return err(
          "Create task from freeform PM action is not implemented yet. Link an AI proposed task first.",
          501,
          "NOT_IMPLEMENTED",
        );
      }

      const supabaseUrlForFn = supabaseUrl;
      const results: unknown[] = [];
      const errors: string[] = [];
      for (const aiProposedTaskId of uniqueAiIds) {
        try {
          const fnResp = await fetch(`${supabaseUrlForFn}/functions/v1/clickup-create-task-from-ai-proposal`, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ai_proposed_task_id: aiProposedTaskId,
              assignee_ids: executionPayload.assignee_ids ?? [],
              due_date: executionPayload.due_date,
              due_date_time: executionPayload.due_date_time ?? false,
            }),
          });
          const fnBody = await fnResp.json();
          if (!fnResp.ok) {
            errors.push(fnBody.error ?? `Failed for ${aiProposedTaskId}`);
          } else {
            results.push(fnBody);
          }
        } catch (e) {
          errors.push((e as Error).message);
        }
      }

      const clickupTaskIds = results
        .map((r: any) => r?.clickup_task_link?.clickup_task_id)
        .filter((id): id is string => typeof id === "string");

      const status = errors.length === 0 ? "succeeded" : results.length > 0 ? "partial" : "failed";
      const execution = await recordExecution(supabase, {
        projectId,
        actionItemId: actionItem.id,
        actionType,
        inputPayload,
        resultPayload: { results, errors },
        status,
        errorMessage: errors.length ? errors.join("; ") : null,
        clickupTaskIds,
        createdBy: userId,
      });

      if (status === "failed") {
        await markActionItem(supabase, actionItem.id, {
          execution_status: "failed",
          execution_error: errors.join("; "),
          execution_result: { errors },
        });
        return err("Failed to create ClickUp task(s).", 502, "CLICKUP_ERROR", errors.join("; "));
      }

      await markActionItem(supabase, actionItem.id, {
        execution_status: "succeeded",
        execution_result: { results, errors },
        status: "done",
        completed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
      });
      return json({ execution, action_item_id: actionItem.id, status, results, errors });
    }

    if (!projectLink) {
      await markActionItem(supabase, actionItem.id, {
        execution_status: "failed",
        execution_error: "Project is not linked to ClickUp.",
      });
      return err("Project is not linked to ClickUp.", 400, "CLICKUP_NOT_LINKED");
    }

    let taskIds = payloadTaskIds(actionPayload, executionPayload);
    if (taskIds.length === 0) {
      await markActionItem(supabase, actionItem.id, {
        execution_status: "failed",
        execution_error: "No ClickUp task IDs selected.",
      });
      return err("Select at least one ClickUp task.", 400, "INVALID_INPUT");
    }

    const { data: taskLinks } = await supabase
      .from("clickup_task_links")
      .select("*")
      .eq("project_id", projectId)
      .in("clickup_task_id", taskIds);
    const linkByTaskId = new Map((taskLinks ?? []).map((link: any) => [link.clickup_task_id, link]));

    if (actionType === "assign_clickup_tasks") {
      if (!clickup) return err("ClickUp is not available for this action.", 500, "CONFIG_ERROR");
      const assigneeIds = executionPayload.assignee_ids ?? [];
      if (assigneeIds.length === 0) {
        await markActionItem(supabase, actionItem.id, { execution_status: "failed", execution_error: "assignee_ids required" });
        return err("Select at least one ClickUp assignee.", 400, "INVALID_INPUT");
      }

      const results: Record<string, unknown>[] = [];
      const errors: string[] = [];
      for (const taskId of taskIds) {
        try {
          const updated = await assignClickupTask(clickup, taskId, assigneeIds);
          if (executionPayload.due_date) {
            await setClickupTaskDueDate(clickup, taskId, executionPayload.due_date, executionPayload.due_date_time ?? false);
          }
          const link = linkByTaskId.get(taskId);
          await insertOxusTimelineEvent(supabase, {
            projectId,
            clickupTaskLinkId: link?.id ?? null,
            clickupTaskId: taskId,
            eventType: "oxus_assign_clickup_tasks",
            eventTitle: "Assigned ClickUp task",
            eventSummary: `${actorName ?? "PM"} assigned ${assigneeIds.join(", ")} to "${link?.clickup_task_name ?? taskId}"${
              executionPayload.due_date ? ` with due date ${executionPayload.due_date}` : ""
            }.`,
            actorName,
            actorEmail,
            rawPayload: { action_item_id: actionItem.id, assignee_ids: assigneeIds, execution_payload: executionPayload, oxus_user_id: userId, clickup_username: clickupConnectionUsername },
          });
          results.push({ task_id: taskId, updated });
        } catch (e) {
          errors.push(`${taskId}: ${(e as Error).message}`);
        }
      }

      const status = errors.length === 0 ? "succeeded" : results.length > 0 ? "partial" : "failed";
      const execution = await recordExecution(supabase, {
        projectId,
        actionItemId: actionItem.id,
        actionType,
        inputPayload,
        resultPayload: { results, errors },
        status,
        errorMessage: errors.length ? errors.join("; ") : null,
        clickupTaskIds: taskIds,
        createdBy: userId,
      });

      if (status === "failed") {
        await markActionItem(supabase, actionItem.id, { execution_status: "failed", execution_error: errors.join("; ") });
        return err("Failed to assign ClickUp task(s).", 502, "CLICKUP_ERROR", errors.join("; "));
      }

      await markActionItem(supabase, actionItem.id, {
        execution_status: "succeeded",
        execution_result: { results, errors },
        status: "done",
        completed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
      });
      return json({ execution, action_item_id: actionItem.id, status, results, errors });
    }

    if (actionType === "update_clickup_deadline") {
      if (!clickup) return err("ClickUp is not available for this action.", 500, "CONFIG_ERROR");
      const dueDate = executionPayload.due_date ?? (typeof actionPayload.suggested_due_date === "string" ? actionPayload.suggested_due_date : undefined);
      if (!dueDate) {
        await markActionItem(supabase, actionItem.id, { execution_status: "failed", execution_error: "due_date required" });
        return err("Due date is required.", 400, "INVALID_INPUT");
      }

      const results: Record<string, unknown>[] = [];
      const errors: string[] = [];
      for (const taskId of taskIds) {
        try {
          const updated = await setClickupTaskDueDate(clickup, taskId, dueDate, executionPayload.due_date_time ?? false);
          const link = linkByTaskId.get(taskId);
          await insertOxusTimelineEvent(supabase, {
            projectId,
            clickupTaskLinkId: link?.id ?? null,
            clickupTaskId: taskId,
            eventType: "oxus_update_clickup_deadline",
            eventTitle: "Updated ClickUp deadline",
            eventSummary: `${actorName ?? "PM"} set due date ${dueDate} on "${link?.clickup_task_name ?? taskId}".`,
            actorName,
            actorEmail,
            rawPayload: { action_item_id: actionItem.id, due_date: dueDate, execution_payload: executionPayload, oxus_user_id: userId, clickup_username: clickupConnectionUsername },
          });
          results.push({ task_id: taskId, updated });
        } catch (e) {
          errors.push(`${taskId}: ${(e as Error).message}`);
        }
      }

      const status = errors.length === 0 ? "succeeded" : results.length > 0 ? "partial" : "failed";
      const execution = await recordExecution(supabase, {
        projectId,
        actionItemId: actionItem.id,
        actionType,
        inputPayload,
        resultPayload: { results, errors },
        status,
        errorMessage: errors.length ? errors.join("; ") : null,
        clickupTaskIds: taskIds,
        createdBy: userId,
      });

      if (status === "failed") {
        await markActionItem(supabase, actionItem.id, { execution_status: "failed", execution_error: errors.join("; ") });
        return err("Failed to update ClickUp deadline(s).", 502, "CLICKUP_ERROR", errors.join("; "));
      }

      await markActionItem(supabase, actionItem.id, {
        execution_status: "succeeded",
        execution_result: { results, errors },
        status: "done",
        completed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
      });
      return json({ execution, action_item_id: actionItem.id, status, results, errors });
    }

    if (actionType === "add_clickup_comment") {
      if (!clickup) return err("ClickUp is not available for this action.", 500, "CONFIG_ERROR");
      const commentText =
        executionPayload.comment_text?.trim() ||
        (typeof actionPayload.suggested_comment === "string" ? actionPayload.suggested_comment : "");
      if (!commentText) {
        await markActionItem(supabase, actionItem.id, { execution_status: "failed", execution_error: "comment_text required" });
        return err("Comment text is required.", 400, "INVALID_INPUT");
      }

      const results: Record<string, unknown>[] = [];
      const errors: string[] = [];
      for (const taskId of taskIds) {
        try {
          const comment = await addClickupTaskComment(clickup, taskId, commentText);
          const link = linkByTaskId.get(taskId);
          await insertOxusTimelineEvent(supabase, {
            projectId,
            clickupTaskLinkId: link?.id ?? null,
            clickupTaskId: taskId,
            eventType: "oxus_add_clickup_comment",
            eventTitle: "Added ClickUp comment",
            eventSummary: `${actorName ?? "PM"} posted a ClickUp comment on "${link?.clickup_task_name ?? taskId}".`,
            actorName,
            actorEmail,
            rawPayload: { action_item_id: actionItem.id, comment_text: commentText, oxus_user_id: userId, clickup_username: clickupConnectionUsername },
          });
          results.push({ task_id: taskId, comment });
        } catch (e) {
          errors.push(`${taskId}: ${(e as Error).message}`);
        }
      }

      const status = errors.length === 0 ? "succeeded" : results.length > 0 ? "partial" : "failed";
      const execution = await recordExecution(supabase, {
        projectId,
        actionItemId: actionItem.id,
        actionType,
        inputPayload,
        resultPayload: { results, errors },
        status,
        errorMessage: errors.length ? errors.join("; ") : null,
        clickupTaskIds: taskIds,
        createdBy: userId,
      });

      if (status === "failed") {
        await markActionItem(supabase, actionItem.id, { execution_status: "failed", execution_error: errors.join("; ") });
        return err("Failed to add ClickUp comment(s).", 502, "CLICKUP_ERROR", errors.join("; "));
      }

      await markActionItem(supabase, actionItem.id, {
        execution_status: "succeeded",
        execution_result: { results, errors },
        status: "done",
        completed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
      });
      return json({ execution, action_item_id: actionItem.id, status, results, errors });
    }

    return err(`Action type ${actionType} is not supported.`, 400, "INVALID_INPUT");
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
