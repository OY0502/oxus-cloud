import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getClickupBaseUrl, resolveUserClickupForProject } from "../clickup-auth.ts";
import { addClickupTaskComment, ensureProjectClickupSpace, fetchClickupTask, updateClickupTask } from "../clickup.ts";
import { removeMentionSyntax } from "./linkedReferences.ts";
import { createProjectClickUpTask } from "../clickupTaskCreation.ts";
import {
  createClickupDoc,
  normalizeClickupDocPayload,
  recordClickupDocSource,
  recordTimelineDocEvent,
} from "./clickupDocs.ts";
import {
  queueClickupDocsPostProcessing,
  syncClickupDocsForProject,
} from "../clickupDocSyncPipeline.ts";

async function loadProjectClickupLink(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
}) {
  const { clickup } = await resolveUserClickupForProject(args.userId, args.projectId);
  const { data: project } = await args.admin
    .from("projects")
    .select("id, name")
    .eq("id", args.projectId)
    .single();
  if (!project) throw new Error("Project not found.");

  const { link } = await ensureProjectClickupSpace({
    supabase: args.admin,
    clickup,
    projectId: args.projectId,
    projectName: String(project.name ?? "Project"),
    createdBy: args.userId,
    webhookEndpoint: Deno.env.get("CLICKUP_WEBHOOK_ENDPOINT")?.trim(),
    webhookSecret: Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim(),
  });
  return { clickup, link };
}

export async function executeCreateClickupTaskFromToolRun(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const title = String(args.payload.title ?? "").trim();
  if (!title) throw new Error("ClickUp task title is required.");

  const { clickup } = await resolveUserClickupForProject(args.userId, args.projectId);
  const sourceId = String(args.payload.source_id ?? args.payload.tool_run_id ?? crypto.randomUUID());

  const created = await createProjectClickUpTask({
    supabase: args.admin,
    clickup,
    webhookEndpoint: Deno.env.get("CLICKUP_WEBHOOK_ENDPOINT")?.trim(),
    webhookSecret: Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim(),
    existingTaskLinkQuery: null,
    input: {
      projectId: args.projectId,
      actorUserId: args.userId,
      sourceType: "agent",
      sourceId,
      name: title,
      description: String(args.payload.description ?? ""),
      statusIdOrName: typeof args.payload.status === "string" ? args.payload.status : undefined,
      assigneeUserIds: Array.isArray(args.payload.assignee_ids)
        ? args.payload.assignee_ids.map((id) => String(id))
        : [],
      priority: typeof args.payload.priority === "string" ? args.payload.priority : null,
      startDate: typeof args.payload.start_date === "string" ? args.payload.start_date : null,
      dueDate: typeof args.payload.due_date === "string" ? args.payload.due_date : null,
      timeEstimateMinutes:
        typeof args.payload.time_estimate_minutes === "number" ? args.payload.time_estimate_minutes : null,
      tagNames: Array.isArray(args.payload.tag_names)
        ? args.payload.tag_names.map((tag) => String(tag))
        : [],
      allowCreateTags: false,
    },
  });

  await args.admin.from("project_timeline_events").insert({
    project_id: args.projectId,
    source_type: "clickup",
    event_type: "clickup_task_created",
    event_title: title,
    event_summary: "ClickUp task created by project agent",
    related_clickup_task_id: created.clickupTaskId,
    source_url: created.clickupTaskUrl,
    metadata: { via: "agent", warnings: created.warnings },
  });

  return {
    clickup_task_id: created.clickupTaskId,
    url: created.clickupTaskUrl,
    title,
    warnings: created.warnings,
  };
}

export async function executeAddClickupCommentFromToolRun(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const taskId = String(args.payload.task_id ?? "").trim();
  const rawComment = String(args.payload.comment_text ?? "").trim();
  if (!taskId) throw new Error("ClickUp task ID is required.");
  if (!rawComment) throw new Error("ClickUp comment text is required.");

  const allowClientMentions = args.payload.allow_client_mentions === true;
  const comment = (allowClientMentions ? rawComment : removeMentionSyntax(rawComment)).slice(0, 8000);
  if (!comment) throw new Error("The ClickUp comment is empty after safety checks.");

  const botToken = Deno.env.get("CLICKUP_BOT_API_TOKEN")?.trim()
    || Deno.env.get("CLICKUP_API_TOKEN")?.trim();
  const connected = botToken ? null : await resolveUserClickupForProject(args.userId, args.projectId);
  const clickup = botToken
    ? { apiToken: botToken, baseUrl: getClickupBaseUrl() }
    : connected!.clickup;
  const task = await fetchClickupTask(clickup, taskId) as Record<string, unknown>;
  const taskSpaceId = String(((task.space ?? {}) as Record<string, unknown>).id ?? "");
  const { data: projectLink } = await args.admin
    .from("project_clickup_links")
    .select("clickup_space_id")
    .eq("project_id", args.projectId)
    .maybeSingle();
  const { data: taskLink } = await args.admin
    .from("clickup_task_links")
    .select("id")
    .eq("project_id", args.projectId)
    .eq("clickup_task_id", taskId)
    .maybeSingle();
  const linkedSpaceId = String(projectLink?.clickup_space_id ?? "");
  if (!taskLink && (!linkedSpaceId || taskSpaceId !== linkedSpaceId)) {
    throw new Error("That ClickUp task is outside this project.");
  }

  const result = await addClickupTaskComment(clickup, taskId, comment);
  const taskName = String(task.name ?? args.payload.task_name ?? taskId);
  const taskUrl = String(task.url ?? args.payload.task_url ?? `https://app.clickup.com/t/${taskId}`);
  await args.admin.from("project_timeline_events").insert({
    project_id: args.projectId,
    source_type: "clickup",
    event_type: "clickup_comment_added",
    event_title: `Comment added to ${taskName}`,
    event_summary: comment.slice(0, 500),
    related_clickup_task_id: taskId,
    source_url: taskUrl,
    metadata: {
      via: "project_chat",
      actor_mode: botToken ? "bot" : "connected_user",
      client_mentions_allowed: allowClientMentions,
      source_links: Array.isArray(args.payload.source_links) ? args.payload.source_links : [],
    },
  });

  return {
    clickup_task_id: taskId,
    clickup_comment_id: result?.id ?? null,
    url: taskUrl,
    task_name: taskName,
    actor_mode: botToken ? "bot" : "connected_user",
  };
}

export async function executeCreateClickupDocFromToolRun(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { title, markdown } = normalizeClickupDocPayload(args.payload);
  if (!title) throw new Error("ClickUp doc title is required.");
  if (!markdown) throw new Error("ClickUp doc content is required.");

  const { clickup, link } = await loadProjectClickupLink(args);

  const destination = args.payload.destination as {
    type?: string;
    id?: string;
    path?: string;
  } | undefined;
  const parent = args.payload.parent as { type?: string; id?: string } | undefined;

  const spaceId = String(link.clickup_space_id ?? "");
  const folderId = String(
    parent?.type === "folder" ? parent.id : destination?.type === "folder" ? destination.id : link.clickup_folder_id ?? "",
  );
  const listId = String(
    parent?.type === "list" ? parent.id : destination?.type === "list" ? destination.id : link.clickup_list_id ?? "",
  );
  const workspaceId = clickup.teamId;
  if (!spaceId && !folderId && !listId) {
    throw new Error("Project ClickUp space is not configured.");
  }

  const doc = await createClickupDoc(clickup, {
    title,
    markdown_content: markdown,
    space_id: destination?.type === "space" ? destination.id : spaceId || undefined,
    folder_id: folderId || undefined,
    list_id: listId || undefined,
    workspace_id: workspaceId,
  });

  const sourceId = await recordClickupDocSource({
    admin: args.admin,
    projectId: args.projectId,
    userId: args.userId,
    doc,
    markdown,
  });

  await recordTimelineDocEvent({
    admin: args.admin,
    projectId: args.projectId,
    title: doc.title,
    docUrl: doc.doc_url,
    sourceId,
  });

  return { doc_id: doc.doc_id, url: doc.doc_url, title: doc.title, source_id: sourceId, destination: destination ?? null };
}

export async function executeLinkClickupDocToTaskFromToolRun(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const docId = String(args.payload.doc_id ?? args.payload.doc_ref ?? "").trim();
  const docUrl = String(args.payload.doc_url ?? "").trim();
  const taskId = String(args.payload.task_id ?? args.payload.task_ref ?? "").trim();
  const taskUrl = String(args.payload.task_url ?? "").trim();
  const linkMode = String(args.payload.link_mode ?? "task_description");

  if (!taskId) throw new Error("ClickUp task id is required to link a doc.");
  const resolvedDocUrl = docUrl || (docId ? `https://app.clickup.com/doc/${docId}` : "");
  if (!resolvedDocUrl) throw new Error("ClickUp doc URL or id is required to link a doc to a task.");

  const { clickup } = await loadProjectClickupLink(args);
  const linkLine = `Related guide: ${resolvedDocUrl}`;
  let usedMode = linkMode;
  let detail = "";

  if (linkMode === "clickup_attachment") {
    // ClickUp public API does not expose doc-to-task attachment; fall back safely.
    usedMode = "task_description";
    detail = "ClickUp doc attachment API is not available; added doc link to task description instead.";
  }

  if (usedMode === "task_description" || usedMode === "clickup_attachment") {
    const taskResp = await fetch(`${clickup.baseUrl}/task/${taskId}`, {
      headers: { Authorization: `Bearer ${clickup.apiToken}` },
    });
    const taskText = await taskResp.text();
    if (!taskResp.ok) {
      throw new Error(`ClickUp task fetch failed (${taskResp.status}): ${taskText.slice(0, 400)}`);
    }
    const task = JSON.parse(taskText) as { description?: string };
    const existing = String(task.description ?? "").trim();
    const nextDescription = existing.includes(resolvedDocUrl)
      ? existing
      : existing
      ? `${existing}\n\n${linkLine}`
      : linkLine;
    await updateClickupTask(clickup, taskId, { description: nextDescription });
  } else if (usedMode === "task_comment") {
    await addClickupTaskComment(clickup, taskId, linkLine);
  } else if (usedMode === "internal_link") {
    detail = "Stored relationship in OXUS timeline only.";
  } else {
    throw new Error(`Unsupported link_mode: ${usedMode}`);
  }

  await args.admin.from("project_timeline_events").insert({
    project_id: args.projectId,
    source_type: "clickup",
    event_type: "clickup_doc_linked_to_task",
    event_title: "ClickUp doc linked to task",
    event_summary: `Linked doc to task via ${usedMode.replace(/_/g, " ")}`,
    related_clickup_task_id: taskId,
    source_url: resolvedDocUrl,
    metadata: {
      via: "agent",
      doc_id: docId || null,
      doc_url: resolvedDocUrl,
      task_id: taskId,
      task_url: taskUrl || `https://app.clickup.com/t/${taskId}`,
      link_mode: usedMode,
      detail: detail || null,
    },
  });

  return {
    doc_id: docId || null,
    doc_url: resolvedDocUrl,
    clickup_task_id: taskId,
    task_url: taskUrl || `https://app.clickup.com/t/${taskId}`,
    link_mode: usedMode,
    detail: detail || undefined,
  };
}

export async function executeSyncClickupDocsFromToolRun(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  syncAllWorkspaceDocs?: boolean;
  runInlinePostProcessing?: boolean;
}): Promise<Record<string, unknown>> {
  const { clickup, link } = await loadProjectClickupLink(args);

  const spaceId = String(link.clickup_space_id ?? "");
  if (!spaceId && !args.syncAllWorkspaceDocs) {
    throw new Error("Project ClickUp space is not configured.");
  }

  const syncResult = await syncClickupDocsForProject({
    admin: args.admin,
    clickup,
    projectId: args.projectId,
    userId: args.userId,
    link: {
      clickup_space_id: link.clickup_space_id,
      clickup_folder_id: link.clickup_folder_id,
      clickup_list_id: link.clickup_list_id,
      space_name: (link as Record<string, unknown>).space_name as string | null | undefined,
      folder_name: (link as Record<string, unknown>).folder_name as string | null | undefined,
      list_name: (link as Record<string, unknown>).list_name as string | null | undefined,
    },
    syncAllWorkspaceDocs: args.syncAllWorkspaceDocs,
  });

  const queued = await queueClickupDocsPostProcessing({
    admin: args.admin,
    projectId: args.projectId,
    userId: args.userId,
    syncResult,
    runInline: args.runInlinePostProcessing,
  });

  return {
    ...syncResult,
    memory_update_queued: queued.memory_update_queued,
    embedding_queued: queued.embedding_queued,
    embedding_enabled: queued.embedding_enabled,
    retrieval_mode: queued.retrieval_mode,
    trigger_run_ids: queued.trigger_run_ids,
    synced_count: syncResult.docs_imported + syncResult.docs_updated,
  };
}
