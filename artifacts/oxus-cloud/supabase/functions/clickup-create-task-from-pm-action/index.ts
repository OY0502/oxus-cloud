import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clickupFetch,
  dateToClickupDue,
  ensureProjectClickupSpace,
  fetchListStatuses,
  matchListStatus,
  minutesToClickupTimeEstimate,
  oxusPriorityToClickup,
  pickDefaultStatus,
  validateCachedAssigneeIds,
} from "../_shared/clickup.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
import { buildPmActionClickupMarkdown } from "../_shared/pmActionClickupDescription.ts";

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

function normalizePriority(value: unknown): string {
  if (value === "urgent" || value === "high" || value === "medium" || value === "low") return value;
  return "medium";
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

    const webhookEndpoint = Deno.env.get("CLICKUP_WEBHOOK_ENDPOINT")?.trim();
    const webhookSecret = Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim();

    let body: {
      pm_action_item_id?: string;
      title?: string;
      description?: string;
      assignee_ids?: string[];
      due_date?: string;
      priority?: "low" | "medium" | "high" | "urgent";
      status?: string;
      time_estimate_minutes?: number;
    };
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }
    if (!body.pm_action_item_id) return err("pm_action_item_id is required.", 400, "INVALID_INPUT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth.user) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const { data: pmAction, error: actionErr } = await supabase
      .from("project_pm_action_items")
      .select("*")
      .eq("id", body.pm_action_item_id)
      .single();
    if (actionErr || !pmAction) return err("PM action item not found.", 404, "NOT_FOUND", actionErr?.message);

    const projectId = pmAction.project_id as string;

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();
    if (projErr || !project) return err("Project not found.", 404, "NOT_FOUND", projErr?.message);

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(auth.user.id, projectId));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const { data: existingByActionLink } = await supabase
      .from("clickup_task_links")
      .select("*")
      .eq("pm_action_item_id", body.pm_action_item_id)
      .maybeSingle();

    if (existingByActionLink) {
      return json({
        pm_action_item: pmAction,
        clickup_task_link: existingByActionLink,
        already_created: true,
        message: "Already created in ClickUp.",
      });
    }

    if (pmAction.clickup_task_id) {
      const { data: existingByTaskId } = await supabase
        .from("clickup_task_links")
        .select("*")
        .eq("clickup_task_id", pmAction.clickup_task_id)
        .maybeSingle();
      return json({
        pm_action_item: pmAction,
        clickup_task_link: existingByTaskId ?? null,
        already_created: true,
        message: "Already created in ClickUp.",
      });
    }

    const taskTitle =
      (typeof body.title === "string" && body.title.trim()) ||
      (typeof pmAction.suggested_task_title === "string" && pmAction.suggested_task_title.trim()) ||
      (typeof pmAction.title === "string" ? pmAction.title : "Task from PM action");
    const taskDescription =
      (typeof body.description === "string" && body.description.trim()) ||
      (typeof pmAction.suggested_task_description === "string" && pmAction.suggested_task_description.trim()) ||
      (typeof pmAction.description === "string" ? pmAction.description : null);
    const priority = normalizePriority(
      body.priority ?? pmAction.suggested_priority ?? pmAction.priority,
    );

    const defaultAssigneeIds = Array.isArray(pmAction.suggested_clickup_assignee_ids)
      ? pmAction.suggested_clickup_assignee_ids.filter((id): id is string => typeof id === "string" && id.trim())
      : Array.isArray(pmAction.selected_clickup_assignee_ids)
      ? pmAction.selected_clickup_assignee_ids.filter((id): id is string => typeof id === "string" && id.trim())
      : [];
    const assigneeIds = Array.isArray(body.assignee_ids)
      ? body.assignee_ids.filter((id): id is string => typeof id === "string" && id.trim()).map((id) => id.trim())
      : defaultAssigneeIds;
    const dueDate =
      (typeof body.due_date === "string" && body.due_date.trim()) ||
      (typeof pmAction.suggested_due_date === "string" && pmAction.suggested_due_date.trim()) ||
      (typeof pmAction.selected_due_date === "string" && pmAction.selected_due_date.trim()) ||
      null;
    // Date-only: no due-time support (PART 3).
    const dueDateTime = false;
    const requestedStatus = typeof body.status === "string" ? body.status.trim() : "";
    const timeEstimateMs = minutesToClickupTimeEstimate(body.time_estimate_minutes);
    const warnings: string[] = [];
    const validatedAssigneeIds = await validateCachedAssigneeIds(supabase, clickup.teamId, assigneeIds);

    await supabase
      .from("project_pm_action_items")
      .update({
        selected_clickup_assignee_ids: validatedAssigneeIds,
        selected_due_date: dueDate,
        selected_due_date_time: dueDateTime,
        clickup_sync_status: "syncing",
        clickup_sync_error: null,
      })
      .eq("id", body.pm_action_item_id);

    const recordSyncError = async (message: string) => {
      await supabase
        .from("project_pm_action_items")
        .update({ clickup_sync_status: "error", clickup_sync_error: message.slice(0, 1000) })
        .eq("id", body.pm_action_item_id);
    };

    let spaceResult: Awaited<ReturnType<typeof ensureProjectClickupSpace>>;
    try {
      spaceResult = await ensureProjectClickupSpace({
        supabase,
        clickup,
        projectId,
        projectName: (project as { name: string }).name,
        createdBy: auth.user.id,
        webhookEndpoint,
        webhookSecret,
      });
    } catch (e) {
      await recordSyncError((e as Error).message);
      return err("Failed to ensure ClickUp space.", 502, "CLICKUP_ERROR", (e as Error).message);
    }

    const link = spaceResult.link as Record<string, unknown>;
    const listId = link.clickup_list_id as string;
    const priorityInt = oxusPriorityToClickup(priority);

    const sourceMetadata = (pmAction.source_metadata ?? {}) as Record<string, unknown>;
    const markdownContent = buildPmActionClickupMarkdown({
      title: taskTitle,
      description: taskDescription,
      sourceType: typeof pmAction.source_type === "string" ? pmAction.source_type : pmAction.source,
      sourceApp: typeof pmAction.source_app === "string" ? pmAction.source_app : null,
      sourceMessage:
        typeof pmAction.source_message === "string"
          ? pmAction.source_message
          : null,
      channelName:
        typeof sourceMetadata.channel_name === "string"
          ? sourceMetadata.channel_name
          : typeof pmAction.source_label === "string"
          ? pmAction.source_label.replace(/^#/, "")
          : null,
      actorName: typeof pmAction.source_actor_name === "string" ? pmAction.source_actor_name : null,
      messageTs: typeof pmAction.source_message_ts === "string" ? pmAction.source_message_ts : null,
      attachments: sourceMetadata.attachments,
      projectName: (project as { name: string }).name,
      projectId,
    });

    let clickupTask: Record<string, unknown>;
    try {
      const statuses = await fetchListStatuses(clickup, listId);
      const defaultStatus = pickDefaultStatus(statuses);
      let resolvedStatus = defaultStatus;
      if (requestedStatus) {
        const { matched, exists } = matchListStatus(statuses, requestedStatus);
        if (exists && matched) {
          resolvedStatus = matched;
        } else {
          warnings.push(
            `Requested status "${requestedStatus}" does not exist in the ClickUp list. Used "${
              defaultStatus ?? "list default"
            }" instead. Create the status in ClickUp or pick an existing one.`,
          );
        }
      }

      const taskBody: Record<string, unknown> = {
        name: taskTitle,
        markdown_content: markdownContent,
      };
      if (resolvedStatus) taskBody.status = resolvedStatus;
      if (priorityInt !== undefined) taskBody.priority = priorityInt;
      if (timeEstimateMs !== undefined) taskBody.time_estimate = timeEstimateMs;
      if (validatedAssigneeIds.length > 0) {
        taskBody.assignees = validatedAssigneeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
      }
      if (dueDate) {
        taskBody.due_date = dateToClickupDue(dueDate, dueDateTime);
        taskBody.due_date_time = dueDateTime;
      }
      clickupTask = await clickupFetch(clickup, `/list/${listId}/task`, {
        method: "POST",
        body: JSON.stringify(taskBody),
      }) as Record<string, unknown>;
    } catch (e) {
      await recordSyncError((e as Error).message);
      return err("Failed to create task in ClickUp.", 502, "CLICKUP_ERROR", (e as Error).message);
    }

    const clickupTaskId = String(clickupTask.id);
    const clickupTaskUrl =
      (typeof clickupTask.url === "string" ? clickupTask.url : null) ??
      `https://app.clickup.com/t/${clickupTaskId}`;
    const clickupStatus =
      clickupTask.status && typeof clickupTask.status === "object"
        ? String((clickupTask.status as Record<string, unknown>).status ?? "Open")
        : "Open";

    const now = new Date().toISOString();
    const { data: taskLink, error: linkErr } = await supabase
      .from("clickup_task_links")
      .insert({
        project_id: projectId,
        pm_action_item_id: body.pm_action_item_id,
        clickup_team_id: clickup.teamId,
        clickup_space_id: link.clickup_space_id,
        clickup_folder_id: link.clickup_folder_id,
        clickup_list_id: listId,
        clickup_task_id: clickupTaskId,
        clickup_task_url: clickupTaskUrl,
        clickup_task_name: taskTitle,
        clickup_status: clickupStatus,
        clickup_priority: priority,
        last_snapshot: clickupTask,
        last_synced_at: now,
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (linkErr) {
      await recordSyncError(linkErr.message);
      return err("Task created in ClickUp but failed to save link in OXUS.", 500, "DB_ERROR", linkErr.message);
    }

    const relatedTaskIds = Array.isArray(pmAction.related_clickup_task_ids)
      ? [...(pmAction.related_clickup_task_ids as string[])]
      : [];
    if (!relatedTaskIds.includes(clickupTaskId)) relatedTaskIds.push(clickupTaskId);

    const relatedTaskTitles = Array.isArray(pmAction.related_clickup_task_titles)
      ? [...(pmAction.related_clickup_task_titles as string[])]
      : [];
    if (!relatedTaskTitles.includes(taskTitle)) relatedTaskTitles.push(taskTitle);

    const { data: updatedAction } = await supabase
      .from("project_pm_action_items")
      .update({
        clickup_task_id: clickupTaskId,
        clickup_task_url: clickupTaskUrl,
        clickup_sync_status: "synced",
        clickup_synced_at: now,
        clickup_sync_error: null,
        selected_clickup_assignee_ids: validatedAssigneeIds,
        selected_due_date: dueDate,
        selected_due_date_time: dueDateTime,
        status: "done",
        execution_status: "succeeded",
        executed_at: now,
        completed_at: now,
        related_clickup_task_ids: relatedTaskIds,
        related_clickup_task_titles: relatedTaskTitles,
      })
      .eq("id", body.pm_action_item_id)
      .select()
      .single();

    const sourceSummary =
      typeof pmAction.source_app === "string"
        ? pmAction.source_app
        : typeof pmAction.source_type === "string"
        ? pmAction.source_type
        : "PM action";

    await supabase.from("project_timeline_events").insert({
      project_id: projectId,
      source_type: "pm_action",
      source_table: "project_pm_action_items",
      source_id: body.pm_action_item_id,
      event_type: "clickup_task_created_from_pm_action",
      event_title: "Created ClickUp task from PM action",
      event_summary: `Task "${taskTitle}" created in ClickUp from ${sourceSummary}.`,
      related_pm_action_item_id: body.pm_action_item_id,
      related_clickup_task_id: clickupTaskId,
      metadata: {
        clickup_task_link_id: taskLink.id,
        assignee_ids: validatedAssigneeIds,
        due_date: dueDate,
        due_date_time: dueDateTime,
        priority,
      },
    });

    await supabase.from("project_clickup_timeline_events").insert({
      project_id: projectId,
      clickup_task_link_id: taskLink.id,
      clickup_task_id: clickupTaskId,
      event_type: "clickup_task_created",
      event_title: "Created ClickUp task from PM action",
      event_summary: `Task "${taskTitle}" created from PM action (${sourceSummary}).`,
      direction: "to_clickup",
      source: "oxus_action",
      raw_payload: {
        clickup_task: clickupTask,
        pm_action_item_id: body.pm_action_item_id,
        assignee_ids: validatedAssigneeIds,
        due_date: dueDate,
        due_date_time: dueDateTime,
      },
    });

    return json({
      pm_action_item: updatedAction ?? pmAction,
      clickup_task_link: taskLink,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
