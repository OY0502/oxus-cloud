import { clickupFetch } from "../_shared/clickup.ts";
import { getServiceRoleSupabase, resolveUserClickupForProject } from "../_shared/clickup-auth.ts";
import { generateStructuredObject, oxusIdentityGuidance } from "../_shared/agent/aiModel.ts";
import { embedProjectKnowledgeChunks } from "../_shared/agent/retrieval.ts";
import { chunkKnowledgeText } from "../_shared/knowledgeChunking.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  const valueText = typeof value === "string" ? value.trim() : "";
  return valueText || null;
}

function taskSnapshot(task: Record<string, unknown>) {
  const status = object(task.status);
  const priority = object(task.priority);
  const list = object(task.list);
  const folder = object(task.folder);
  const space = object(task.space);
  const assignees = Array.isArray(task.assignees)
    ? task.assignees.map((entry) => text(object(entry).username) ?? text(object(entry).email)).filter(Boolean)
    : [];
  return {
    id: String(task.id ?? ""),
    name: text(task.name) ?? "Untitled task",
    status: text(status.status) ?? "Unknown",
    priority: text(priority.priority),
    description: text(task.markdown_description) ?? text(task.description),
    url: text(task.url),
    due_date: text(task.due_date),
    date_updated: text(task.date_updated),
    time_estimate: Number(task.time_estimate) || null,
    time_spent: Number(task.time_spent) || null,
    assignees,
    list_id: text(list.id),
    folder_id: text(folder.id),
    space_id: text(space.id),
  };
}

function buildKnowledgeText(projectName: string, spaceName: string | null, tasks: ReturnType<typeof taskSnapshot>[]) {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  const statusLine = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => `${status}: ${count}`).join(", ");
  const taskLines = tasks.map((task) => [
    `- ${task.name} [${task.status}]`,
    task.priority ? `priority=${task.priority}` : null,
    task.assignees.length ? `assignees=${task.assignees.join(", ")}` : null,
    task.due_date ? `due=${new Date(Number(task.due_date)).toISOString().slice(0, 10)}` : null,
    task.description ? `description=${task.description.replace(/\s+/g, " ").slice(0, 800)}` : null,
    task.url ? `url=${task.url}` : null,
  ].filter(Boolean).join(" · "));
  return [
    `ClickUp project snapshot for ${projectName}`,
    `Space: ${spaceName ?? "Linked ClickUp space"}`,
    `Tasks discovered: ${tasks.length}`,
    `Status distribution: ${statusLine || "No tasks"}`,
    "",
    ...taskLines,
  ].join("\n");
}

function fallbackSummary(projectName: string, count: number, statusCounts: Record<string, number>) {
  const statuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([status, total]) => `- **${status}:** ${total}`).join("\n");
  return [
    `# ClickUp context is ready for ${projectName}`,
    `I scanned the connected ClickUp space and added **${count} existing task${count === 1 ? "" : "s"}** to this project's shared context.`,
    statuses ? `## Current task picture\n${statuses}` : "No tasks were present in the connected space yet.",
    "## Ready for more context",
    "You can now add meeting recordings, transcripts, documents, Slack context, or ask a project question. New information will be analyzed against this ClickUp baseline.",
  ].filter(Boolean).join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!(await isServiceRoleRequest(req))) return json({ error: "Service role required." }, 401);

  const admin = getServiceRoleSupabase();
  const body = await req.json().catch(() => ({})) as { project_id?: string; user_id?: string; force?: boolean };
  const projectId = body.project_id?.trim();
  const userId = body.user_id?.trim();
  if (!projectId || !userId) return json({ error: "project_id and user_id are required." }, 400);

  const { data: link } = await admin.from("project_clickup_links").select("*").eq("project_id", projectId).maybeSingle();
  if (!link?.clickup_space_id) return json({ error: "An active ClickUp space link is required." }, 409);
  const currentMetadata = object(link.metadata);
  if (!body.force && currentMetadata.initial_scan_status === "completed") {
    return json({ status: "completed", skipped: true, task_count: currentMetadata.initial_scan_task_count ?? 0 });
  }

  const startedAt = new Date().toISOString();
  await admin.from("project_clickup_links").update({
    last_error: null,
    metadata: { ...currentMetadata, initial_scan_status: "running", initial_scan_started_at: startedAt },
  }).eq("project_id", projectId);

  try {
    const [{ clickup }, projectResult] = await Promise.all([
      resolveUserClickupForProject(userId, projectId),
      admin.from("projects").select("id, name, type").eq("id", projectId).single(),
    ]);
    if (projectResult.error || !projectResult.data) throw new Error(projectResult.error?.message ?? "Project not found.");

    const rawTasks: Record<string, unknown>[] = [];
    for (let page = 0; page < 20 && rawTasks.length < 2000; page += 1) {
      const path = `/team/${encodeURIComponent(clickup.teamId)}/task?space_ids%5B%5D=${encodeURIComponent(String(link.clickup_space_id))}&include_closed=true&subtasks=true&include_markdown_description=true&order_by=updated&page=${page}`;
      const response = await clickupFetch(clickup, path) as { tasks?: Record<string, unknown>[]; last_page?: boolean };
      const pageTasks = Array.isArray(response.tasks) ? response.tasks : [];
      rawTasks.push(...pageTasks);
      if (response.last_page === true || pageTasks.length < 100) break;
    }
    const tasks = rawTasks.map(taskSnapshot).filter((task) => task.id);
    const now = new Date().toISOString();
    if (tasks.length) {
      const { error } = await admin.from("clickup_task_links").upsert(tasks.map((task) => ({
        project_id: projectId,
        clickup_team_id: String(link.clickup_team_id),
        clickup_space_id: task.space_id ?? String(link.clickup_space_id),
        clickup_folder_id: task.folder_id,
        clickup_list_id: task.list_id ?? String(link.clickup_list_id ?? ""),
        clickup_task_id: task.id,
        clickup_task_url: task.url,
        clickup_task_name: task.name,
        clickup_status: task.status,
        clickup_priority: task.priority,
        last_snapshot: task,
        last_synced_at: now,
        created_by: userId,
      })), { onConflict: "clickup_task_id" });
      if (error) throw new Error(error.message);
    }

    const projectName = String(projectResult.data.name ?? "this project");
    const sourceText = buildKnowledgeText(projectName, text(link.space_name), tasks);
    const { data: existingSource } = await admin.from("project_knowledge_sources")
      .select("id, content_version")
      .eq("project_id", projectId).eq("external_provider", "clickup").eq("external_id", String(link.clickup_space_id))
      .maybeSingle();
    let sourceId: string;
    if (existingSource?.id) {
      sourceId = String(existingSource.id);
      await admin.from("project_knowledge_chunks").delete().eq("source_id", sourceId);
      const { error } = await admin.from("project_knowledge_sources").update({
        source_title: `ClickUp · ${text(link.space_name) ?? "Project space"}`,
        char_count: sourceText.length, source_text: sourceText, source_preview: sourceText.slice(0, 1000),
        last_synced_at: now, sync_status: "active", index_status: "pending", index_error: null,
        content_version: Number(existingSource.content_version ?? 1) + 1,
        metadata: { scan_type: "space_wide", task_count: tasks.length, space_id: link.clickup_space_id },
      }).eq("id", sourceId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await admin.from("project_knowledge_sources").insert({
        project_id: projectId, source_type: "clickup", source_title: `ClickUp · ${text(link.space_name) ?? "Project space"}`,
        input_method: "api", char_count: sourceText.length, source_text: sourceText, source_preview: sourceText.slice(0, 1000),
        external_provider: "clickup", external_id: String(link.clickup_space_id), last_synced_at: now,
        metadata: { scan_type: "space_wide", task_count: tasks.length, space_id: link.clickup_space_id }, created_by: userId,
      }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "Could not create ClickUp knowledge source.");
      sourceId = String(data.id);
    }
    const chunks = chunkKnowledgeText(sourceText, { targetChars: 2600, overlapChars: 240 });
    if (chunks.length) {
      const { error } = await admin.from("project_knowledge_chunks").insert(chunks.map((chunk, index) => ({
        project_id: projectId, source_id: sourceId, chunk_index: index, content: chunk.content,
        section_path: chunk.sectionPath, category: "clickup",
        metadata: { source_type: "clickup", source_title: text(link.space_name), section_path: chunk.sectionPath,
          char_start: chunk.charStart, char_end: chunk.charEnd, token_estimate: chunk.tokenEstimate },
      })));
      if (error) throw new Error(error.message);
    }
    const statusCounts = tasks.reduce<Record<string, number>>((acc, task) => ({ ...acc, [task.status]: (acc[task.status] ?? 0) + 1 }), {});
    let summary = fallbackSummary(projectName, tasks.length, statusCounts);
    try {
      const analyzed = await generateStructuredObject<{ summary_markdown: string }>({
        schemaDescription: 'Return JSON: {"summary_markdown":"concise project-manager summary with headings, task/status overview, important themes, risks, and a final note that more project data can be added"}.',
        systemPrompt: `${oxusIdentityGuidance({ projectName, projectType: text(projectResult.data.type) })}\nBe concise, factual, and never invent details.`,
        userPrompt: `Summarize this newly connected ClickUp project context for a project manager.\n\n${sourceText.slice(0, 45000)}`,
        traceName: "clickup-initial-project-scan", trace: { projectId, userId }, maxTokens: 1200,
      });
      if (analyzed.data.summary_markdown?.trim()) summary = analyzed.data.summary_markdown.trim();
    } catch (error) {
      console.warn("[clickup-initial-project-scan] AI summary fallback", (error as Error).message);
    }
    if (!/ready|add|upload/i.test(summary)) summary += "\n\n## Ready for more context\nAdd meeting recordings, documents, Slack context, or ask a project question whenever you’re ready.";

    const summaryKey = `clickup-initial-summary:${link.id}`;
    const { data: existingMessage } = await admin.from("project_chat_messages").select("id").eq("project_id", projectId)
      .contains("metadata", { idempotency_key: summaryKey }).maybeSingle();
    if (!existingMessage?.id) {
      const { data: session, error: sessionError } = await admin.from("project_chat_sessions").insert({
        project_id: projectId, created_by: userId, title: "ClickUp project overview",
      }).select("id").single();
      if (sessionError || !session) throw new Error(sessionError?.message ?? "Could not create initial project chat.");
      const { error: messageError } = await admin.from("project_chat_messages").insert({
        project_id: projectId, chat_session_id: session.id, user_id: null, role: "assistant", content: summary,
        metadata: { idempotency_key: summaryKey, source: "clickup_initial_scan", task_count: tasks.length, knowledge_source_id: sourceId },
      });
      if (messageError) throw new Error(messageError.message);
    }

    await Promise.allSettled([
      embedProjectKnowledgeChunks({ admin, projectId, sourceId, syncPinecone: true }),
      admin.from("project_timeline_events").upsert({
        project_id: projectId, source_type: "clickup", external_id: `clickup-initial-scan:${link.id}`,
        event_type: "clickup_initial_scan", event_title: "ClickUp project context synced",
        event_summary: `${tasks.length} existing ClickUp task${tasks.length === 1 ? "" : "s"} scanned and added to project context.`,
        source_created_at: now, priority: "medium", metadata: { task_count: tasks.length, knowledge_source_id: sourceId },
      }, { onConflict: "id" }),
    ]);

    await admin.from("project_clickup_links").update({
      last_sync_at: now, last_error: null,
      metadata: { ...currentMetadata, initial_scan_status: "completed", initial_scan_started_at: startedAt,
        initial_scan_completed_at: now, initial_scan_task_count: tasks.length, initial_scan_source_id: sourceId },
    }).eq("project_id", projectId);
    return json({ status: "completed", task_count: tasks.length, source_id: sourceId });
  } catch (error) {
    const message = (error as Error).message;
    await admin.from("project_clickup_links").update({
      last_error: message.slice(0, 1000),
      metadata: { ...currentMetadata, initial_scan_status: "failed", initial_scan_started_at: startedAt, initial_scan_failed_at: new Date().toISOString() },
    }).eq("project_id", projectId);
    console.error("[clickup-initial-project-scan] failed", { projectId, message });
    return json({ error: message }, 500);
  }
});
