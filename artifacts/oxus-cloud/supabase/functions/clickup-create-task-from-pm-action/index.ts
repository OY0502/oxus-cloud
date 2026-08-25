import { createClient } from "npm:@supabase/supabase-js@2";
import { ClickupAssigneeValidationError } from "../_shared/clickup.ts";
import { createProjectClickUpTask } from "../_shared/clickupTaskCreation.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
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

function normalizePriority(value: unknown): string | null {
  if (value === "urgent" || value === "high" || value === "medium" || value === "low") return value;
  if (value === "" || value === null || value === undefined) return null;
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

    let body: {
      pm_action_item_id?: string;
      title?: string;
      description?: string;
      assignee_ids?: string[];
      due_date?: string;
      start_date?: string;
      priority?: "low" | "medium" | "high" | "urgent" | "";
      status?: string;
      time_estimate_minutes?: number;
      tag_names?: string[];
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
    const { data: auth } = await supabase.auth.getUser(token);
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const { data: pmAction, error: actionErr } = await supabase
      .from("project_pm_action_items")
      .select("*")
      .eq("id", body.pm_action_item_id)
      .single();
    if (actionErr || !pmAction) return err("PM action item not found.", 404, "NOT_FOUND", actionErr?.message);

    const projectId = pmAction.project_id as string;

    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();
    if (!project) return err("Project not found.", 404, "NOT_FOUND");

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(userId, projectId));
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

    const taskTitle =
      (typeof body.title === "string" && body.title.trim()) ||
      (typeof pmAction.suggested_task_title === "string" && pmAction.suggested_task_title.trim()) ||
      (typeof pmAction.title === "string" ? pmAction.title : "Task from PM action");
    const taskDescription =
      (typeof body.description === "string" && body.description.trim()) ||
      (typeof pmAction.suggested_task_description === "string" && pmAction.suggested_task_description.trim()) ||
      (typeof pmAction.description === "string" ? pmAction.description : null);
    const priority = normalizePriority(body.priority ?? pmAction.suggested_priority ?? pmAction.priority);

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
    const startDate = typeof body.start_date === "string" && body.start_date.trim() ? body.start_date.trim() : null;

    await supabase
      .from("project_pm_action_items")
      .update({
        selected_clickup_assignee_ids: assigneeIds,
        selected_due_date: dueDate,
        selected_due_date_time: false,
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

    const sourceMetadata = (pmAction.source_metadata ?? {}) as Record<string, unknown>;
    const markdownContent = buildPmActionClickupMarkdown({
      title: taskTitle,
      description: taskDescription,
      sourceType: typeof pmAction.source_type === "string" ? pmAction.source_type : pmAction.source,
      sourceApp: typeof pmAction.source_app === "string" ? pmAction.source_app : null,
      sourceMessage: typeof pmAction.source_message === "string" ? pmAction.source_message : null,
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

    let created;
    try {
      created = await createProjectClickUpTask({
        supabase,
        clickup,
        webhookEndpoint: Deno.env.get("CLICKUP_WEBHOOK_ENDPOINT")?.trim(),
        webhookSecret: Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim(),
        existingTaskLinkQuery: null,
        input: {
          projectId,
          actorUserId: userId,
          sourceType: "pm_action",
          sourceId: body.pm_action_item_id,
          name: taskTitle,
          markdownContent,
          statusIdOrName: body.status,
          assigneeUserIds: assigneeIds,
          priority,
          startDate,
          dueDate,
          timeEstimateMinutes: body.time_estimate_minutes,
          tagNames: body.tag_names ?? [],
          allowCreateTags: false,
        },
      });
    } catch (e) {
      const message = (e as Error).message;
      await recordSyncError(message);
      if (e instanceof ClickupAssigneeValidationError) {
        return err(e.message, 400, "ASSIGNEE_NOT_ASSIGNABLE");
      }
      return err("Failed to create task in ClickUp.", 502, "CLICKUP_ERROR", message);
    }

    const now = new Date().toISOString();
    const { data: taskLink, error: linkErr } = await supabase
      .from("clickup_task_links")
      .insert({
        project_id: projectId,
        pm_action_item_id: body.pm_action_item_id,
        clickup_team_id: clickup.teamId,
        clickup_space_id: created.projectClickupLink.clickup_space_id,
        clickup_folder_id: created.projectClickupLink.clickup_folder_id,
        clickup_list_id: created.projectClickupLink.clickup_list_id,
        clickup_task_id: created.clickupTaskId,
        clickup_task_url: created.clickupTaskUrl,
        clickup_task_name: taskTitle,
        clickup_status:
          (created.clickupTask.status as { status?: string } | undefined)?.status ??
          created.resolvedStatus ??
          "Open",
        clickup_priority: priority,
        last_snapshot: created.clickupTask,
        last_synced_at: now,
        created_by: userId,
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
    if (!relatedTaskIds.includes(created.clickupTaskId)) relatedTaskIds.push(created.clickupTaskId);

    const relatedTaskTitles = Array.isArray(pmAction.related_clickup_task_titles)
      ? [...(pmAction.related_clickup_task_titles as string[])]
      : [];
    if (!relatedTaskTitles.includes(taskTitle)) relatedTaskTitles.push(taskTitle);

    const { data: updatedAction } = await supabase
      .from("project_pm_action_items")
      .update({
        clickup_task_id: created.clickupTaskId,
        clickup_task_url: created.clickupTaskUrl,
        clickup_sync_status: "synced",
        clickup_synced_at: now,
        clickup_sync_error: null,
        selected_clickup_assignee_ids: assigneeIds,
        selected_due_date: dueDate,
        selected_due_date_time: false,
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
      related_clickup_task_id: created.clickupTaskId,
      metadata: {
        clickup_task_link_id: taskLink.id,
        assignee_ids: assigneeIds,
        due_date: dueDate,
        start_date: startDate,
        priority,
        tag_names: created.resolvedTags,
      },
    });

    await supabase.from("project_clickup_timeline_events").insert({
      project_id: projectId,
      clickup_task_link_id: taskLink.id,
      clickup_task_id: created.clickupTaskId,
      event_type: "clickup_task_created",
      event_title: "Created ClickUp task from PM action",
      event_summary: `Task "${taskTitle}" created from PM action (${sourceSummary}).`,
      direction: "to_clickup",
      source: "oxus_action",
      raw_payload: {
        clickup_task: created.clickupTask,
        pm_action_item_id: body.pm_action_item_id,
        assignee_ids: assigneeIds,
        due_date: dueDate,
        start_date: startDate,
      },
    });

    return json({
      pm_action_item: updatedAction ?? pmAction,
      clickup_task_link: taskLink,
      warnings: created.warnings.length > 0 ? created.warnings : undefined,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
