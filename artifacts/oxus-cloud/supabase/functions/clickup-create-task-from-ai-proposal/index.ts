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

function buildMarkdownDescription(task: any): string {
  const lines: string[] = [];
  if (task.description?.trim()) {
    lines.push("## Description", task.description.trim(), "");
  }
  if (Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0) {
    lines.push("## Acceptance Criteria");
    for (const ac of task.acceptance_criteria) lines.push(`- ${ac}`);
    lines.push("");
  }
  if (Array.isArray(task.qa_scenarios) && task.qa_scenarios.length > 0) {
    lines.push("## QA Scenarios");
    for (const scenario of task.qa_scenarios) {
      lines.push(`### ${scenario.title} (${scenario.priority ?? "medium"})`);
      if (Array.isArray(scenario.steps)) {
        for (const step of scenario.steps) lines.push(`1. ${step}`);
      }
      if (scenario.expected_result) lines.push(`\n**Expected:** ${scenario.expected_result}`);
      lines.push("");
    }
  }
  if (Array.isArray(task.implementation_notes) && task.implementation_notes.length > 0) {
    lines.push("## Implementation Notes");
    for (const note of task.implementation_notes) lines.push(`- ${note}`);
    lines.push("");
  }
  if (Array.isArray(task.design_notes) && task.design_notes.length > 0) {
    lines.push("## Design Notes");
    for (const note of task.design_notes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("---", "_Created by OXUS Cloud AI — do not edit this line._");
  return lines.join("\n");
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
      ai_proposed_task_id?: string;
      assignee_ids?: string[];
      due_date?: string;
      title?: string;
      description?: string;
      priority?: "low" | "medium" | "high" | "urgent";
      status?: string;
      time_estimate_minutes?: number;
    };
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }
    if (!body.ai_proposed_task_id) return err("ai_proposed_task_id is required.", 400, "INVALID_INPUT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth.user) return err("Authentication required.", 401, "AUTH_REQUIRED");

    // Load the AI proposed task.
    const { data: proposed, error: propErr } = await supabase
      .from("ai_proposed_tasks")
      .select("*")
      .eq("id", body.ai_proposed_task_id)
      .single();
    if (propErr || !proposed) return err("AI proposed task not found.", 404, "NOT_FOUND", propErr?.message);

    // Load the project.
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", proposed.project_id)
      .single();
    if (projErr || !project) return err("Project not found.", 404, "NOT_FOUND", projErr?.message);

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(auth.user.id, proposed.project_id as string));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    // Check for existing ClickUp task link (prevent duplicates).
    const { data: existingLink } = await supabase
      .from("clickup_task_links")
      .select("*")
      .eq("ai_proposed_task_id", body.ai_proposed_task_id)
      .maybeSingle();
    if (existingLink) {
      return json({
        project_clickup_link: null,
        clickup_task_link: existingLink,
        ai_proposed_task: proposed,
        already_created: true,
        message: "Already created in ClickUp.",
      });
    }

    const assigneeIds = Array.isArray(body.assignee_ids)
      ? body.assignee_ids.filter((id): id is string => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [];
    const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : null;
    // Date-only: no due-time support (PART 3).
    const dueDateTime = false;
    const validatedAssigneeIds = await validateCachedAssigneeIds(supabase, clickup.teamId, assigneeIds);

    const taskTitle =
      (typeof body.title === "string" && body.title.trim()) ||
      (typeof proposed.title === "string" ? proposed.title : "Task");
    const taskDescription =
      typeof body.description === "string" ? body.description : (proposed.description ?? null);
    const priority =
      body.priority === "urgent" || body.priority === "high" || body.priority === "medium" || body.priority === "low"
        ? body.priority
        : proposed.priority;
    const requestedStatus = typeof body.status === "string" ? body.status.trim() : "";
    const timeEstimateMs =
      minutesToClickupTimeEstimate(body.time_estimate_minutes) ??
      (proposed.estimate_hours ? minutesToClickupTimeEstimate(proposed.estimate_hours * 60) : undefined);
    const warnings: string[] = [];

    const creationOptions = {
      assignee_ids: validatedAssigneeIds,
      due_date: dueDate,
      due_date_time: dueDateTime,
    };

    await supabase
      .from("ai_proposed_tasks")
      .update({
        selected_clickup_assignee_ids: validatedAssigneeIds,
        selected_due_date: dueDate,
        selected_due_date_time: dueDateTime,
        clickup_creation_options: creationOptions,
      })
      .eq("id", body.ai_proposed_task_id);

    // Mark as syncing.
    await supabase
      .from("ai_proposed_tasks")
      .update({ clickup_sync_status: "syncing" })
      .eq("id", body.ai_proposed_task_id);

    const recordSyncError = async (message: string) => {
      await supabase
        .from("ai_proposed_tasks")
        .update({ clickup_sync_status: "error", clickup_sync_error: message.slice(0, 1000) })
        .eq("id", body.ai_proposed_task_id);
    };

    // Ensure ClickUp space/list exists.
    let spaceResult: Awaited<ReturnType<typeof ensureProjectClickupSpace>>;
    try {
      spaceResult = await ensureProjectClickupSpace({
        supabase,
        clickup,
        projectId: proposed.project_id,
        projectName: (project as any).name as string,
        createdBy: auth.user.id,
        webhookEndpoint,
        webhookSecret,
      });
    } catch (e) {
      await recordSyncError((e as Error).message);
      return err("Failed to ensure ClickUp space.", 502, "CLICKUP_ERROR", (e as Error).message);
    }

    const link = spaceResult.link as any;
    const listId = link.clickup_list_id as string;
    const priorityInt = oxusPriorityToClickup(priority);

    const markdownContent = buildMarkdownDescription({ ...proposed, title: taskTitle, description: taskDescription });

    // Create ClickUp task (status must match this list's configured statuses).
    let clickupTask: any;
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
      });
    } catch (e) {
      await recordSyncError((e as Error).message);
      return err("Failed to create task in ClickUp.", 502, "CLICKUP_ERROR", (e as Error).message);
    }

    const clickupTaskId = String(clickupTask.id);
    const clickupTaskUrl = clickupTask.url ?? `https://app.clickup.com/t/${clickupTaskId}`;

    // Save the ClickUp task link.
    const { data: taskLink, error: linkErr } = await supabase
      .from("clickup_task_links")
      .insert({
        project_id: proposed.project_id,
        ai_proposed_task_id: body.ai_proposed_task_id,
        clickup_team_id: clickup.teamId,
        clickup_space_id: link.clickup_space_id,
        clickup_folder_id: link.clickup_folder_id,
        clickup_list_id: listId,
        clickup_task_id: clickupTaskId,
        clickup_task_url: clickupTaskUrl,
        clickup_task_name: taskTitle,
        clickup_status: clickupTask.status?.status ?? "Open",
        clickup_priority: priority,
        last_snapshot: clickupTask,
        last_synced_at: new Date().toISOString(),
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (linkErr) {
      await recordSyncError(linkErr.message);
      return err("Task created in ClickUp but failed to save link in OXUS.", 500, "DB_ERROR", linkErr.message);
    }

    // Update the AI proposed task with ClickUp sync info.
    const { data: updatedProposed } = await supabase
      .from("ai_proposed_tasks")
      .update({
        status: "accepted",
        clickup_task_id: clickupTaskId,
        clickup_task_url: clickupTaskUrl,
        clickup_sync_status: "synced",
        clickup_synced_at: new Date().toISOString(),
        clickup_sync_error: null,
      })
      .eq("id", body.ai_proposed_task_id)
      .select()
      .single();

    // Record timeline event.
    const assigneeSummary = validatedAssigneeIds.length > 0 ? ` Assignees: ${validatedAssigneeIds.join(", ")}.` : "";
    const dueSummary = dueDate ? ` Due: ${dueDate}${dueDateTime ? " (with time)" : ""}.` : "";
    await supabase.from("project_clickup_timeline_events").insert({
      project_id: proposed.project_id,
      clickup_task_link_id: taskLink.id,
      clickup_task_id: clickupTaskId,
      event_type: "clickup_task_created",
      event_title: "Created ClickUp task",
      event_summary: `Task "${taskTitle}" created in ClickUp from AI proposal.${assigneeSummary}${dueSummary}`,
      direction: "to_clickup",
      source: "oxus_action",
      raw_payload: {
        clickup_task: clickupTask,
        ai_proposed_task_id: body.ai_proposed_task_id,
        assignee_ids: validatedAssigneeIds,
        due_date: dueDate,
        due_date_time: dueDateTime,
      },
    });

    return json({
      project_clickup_link: link,
      clickup_task_link: taskLink,
      ai_proposed_task: updatedProposed ?? proposed,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
