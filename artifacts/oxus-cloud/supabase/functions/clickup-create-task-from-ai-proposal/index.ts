import { createClient } from "npm:@supabase/supabase-js@2";
import { ClickupAssigneeValidationError, CLICKUP_ASSIGNEE_ACCESS_ERROR } from "../_shared/clickup.ts";
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

function buildMarkdownDescription(task: Record<string, unknown>): string {
  const lines: string[] = [];
  if (typeof task.description === "string" && task.description.trim()) {
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
      const s = scenario as Record<string, unknown>;
      lines.push(`### ${s.title} (${s.priority ?? "medium"})`);
      if (Array.isArray(s.steps)) for (const step of s.steps) lines.push(`1. ${step}`);
      if (s.expected_result) lines.push(`\n**Expected:** ${s.expected_result}`);
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

    let body: {
      ai_proposed_task_id?: string;
      assignee_ids?: string[];
      due_date?: string;
      start_date?: string;
      title?: string;
      description?: string;
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
    if (!body.ai_proposed_task_id) return err("ai_proposed_task_id is required.", 400, "INVALID_INPUT");

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

    const { data: proposed, error: propErr } = await supabase
      .from("ai_proposed_tasks")
      .select("*")
      .eq("id", body.ai_proposed_task_id)
      .single();
    if (propErr || !proposed) return err("AI proposed task not found.", 404, "NOT_FOUND", propErr?.message);

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(userId, proposed.project_id as string));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

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
    const startDate = typeof body.start_date === "string" && body.start_date.trim() ? body.start_date.trim() : null;
    const taskTitle =
      (typeof body.title === "string" && body.title.trim()) ||
      (typeof proposed.title === "string" ? proposed.title : "Task");
    const taskDescription =
      typeof body.description === "string" ? body.description : (proposed.description ?? null);
    const priority = body.priority === "" ? null : (body.priority ?? proposed.priority);

    await supabase
      .from("ai_proposed_tasks")
      .update({
        selected_clickup_assignee_ids: assigneeIds,
        selected_due_date: dueDate,
        selected_due_date_time: false,
        clickup_creation_options: {
          assignee_ids: assigneeIds,
          due_date: dueDate,
          start_date: startDate,
          tag_names: body.tag_names ?? [],
        },
        clickup_sync_status: "syncing",
      })
      .eq("id", body.ai_proposed_task_id);

    const recordSyncError = async (message: string) => {
      await supabase
        .from("ai_proposed_tasks")
        .update({ clickup_sync_status: "error", clickup_sync_error: message.slice(0, 1000) })
        .eq("id", body.ai_proposed_task_id);
    };

    let created;
    try {
      created = await createProjectClickUpTask({
        supabase,
        clickup,
        webhookEndpoint: Deno.env.get("CLICKUP_WEBHOOK_ENDPOINT")?.trim(),
        webhookSecret: Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim(),
        existingTaskLinkQuery: null,
        input: {
          projectId: proposed.project_id as string,
          actorUserId: userId,
          sourceType: "ai_proposal",
          sourceId: body.ai_proposed_task_id,
          name: taskTitle,
          description: taskDescription,
          markdownContent: buildMarkdownDescription({ ...proposed, title: taskTitle, description: taskDescription }),
          statusIdOrName: body.status,
          assigneeUserIds: assigneeIds,
          priority: priority as string | null,
          startDate,
          dueDate,
          timeEstimateMinutes: body.time_estimate_minutes ??
            (proposed.estimate_hours ? proposed.estimate_hours * 60 : null),
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

    if (created.warnings.some((w) => w.startsWith("Task already exists"))) {
      const { data: existing } = await supabase
        .from("clickup_task_links")
        .select("*")
        .eq("ai_proposed_task_id", body.ai_proposed_task_id)
        .maybeSingle();
      return json({
        project_clickup_link: created.projectClickupLink,
        clickup_task_link: existing,
        ai_proposed_task: proposed,
        already_created: true,
      });
    }

    const { data: taskLink, error: linkErr } = await supabase
      .from("clickup_task_links")
      .insert({
        project_id: proposed.project_id,
        ai_proposed_task_id: body.ai_proposed_task_id,
        clickup_team_id: clickup.teamId,
        clickup_space_id: created.projectClickupLink.clickup_space_id,
        clickup_folder_id: created.projectClickupLink.clickup_folder_id,
        clickup_list_id: created.projectClickupLink.clickup_list_id,
        clickup_task_id: created.clickupTaskId,
        clickup_task_url: created.clickupTaskUrl,
        clickup_task_name: taskTitle,
        clickup_status: (created.clickupTask.status as { status?: string } | undefined)?.status ?? created.resolvedStatus ?? "Open",
        clickup_priority: priority,
        last_snapshot: created.clickupTask,
        last_synced_at: new Date().toISOString(),
        created_by: userId,
      })
      .select()
      .single();
    if (linkErr) {
      await recordSyncError(linkErr.message);
      return err("Task created in ClickUp but failed to save link in OXUS.", 500, "DB_ERROR", linkErr.message);
    }

    const { data: updatedProposed } = await supabase
      .from("ai_proposed_tasks")
      .update({
        status: "accepted",
        clickup_task_id: created.clickupTaskId,
        clickup_task_url: created.clickupTaskUrl,
        clickup_sync_status: "synced",
        clickup_synced_at: new Date().toISOString(),
        clickup_sync_error: null,
      })
      .eq("id", body.ai_proposed_task_id)
      .select()
      .single();

    await supabase.from("project_clickup_timeline_events").insert({
      project_id: proposed.project_id,
      clickup_task_link_id: taskLink.id,
      clickup_task_id: created.clickupTaskId,
      event_type: "clickup_task_created",
      event_title: "Created ClickUp task",
      event_summary: `Task "${taskTitle}" created in ClickUp from AI proposal.`,
      direction: "to_clickup",
      source: "oxus_action",
      raw_payload: {
        clickup_task: created.clickupTask,
        ai_proposed_task_id: body.ai_proposed_task_id,
        assignee_ids: assigneeIds,
        due_date: dueDate,
        start_date: startDate,
        tag_names: created.resolvedTags,
      },
    });

    return json({
      project_clickup_link: created.projectClickupLink,
      clickup_task_link: taskLink,
      ai_proposed_task: updatedProposed ?? proposed,
      warnings: created.warnings.length > 0 ? created.warnings : undefined,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
