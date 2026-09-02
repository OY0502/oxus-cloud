import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isConfirmableAgentToolRun } from "./toolRunUtils.ts";
import { mergeAndValidateClickupDocPayload } from "./clickupDocTool.ts";
import {
  buildLangfuseTraceUrl,
  generateAgentPlan,
  generateClickupCommentDraft,
  generateMeetingMemory,
  buildAgentContextBlock,
  isLangfuseEnabled,
} from "./aiModel.ts";
import { createLangfuseTrace, patchLangfuseTrace, type TraceMetadata } from "./langfuse.ts";
import { reconcileProjectAttentionItems, type AttentionReconciliationResult } from "./attentionReconciliation.ts";
import {
  buildHistoryAwareRetrievalQuery,
  embedProjectKnowledgeChunks,
  retrieveProjectKnowledge,
} from "./retrieval.ts";
import { buildSuppressedQuestionKeys } from "../memoryMerge.ts";
import { chunkKnowledgeText } from "../knowledgeChunking.ts";
import {
  ensureHierarchyFreshForTools,
  getClickupProjectHierarchy,
  syncClickupProjectHierarchy,
} from "../clickupHierarchy.ts";
import {
  createPendingToolRun,
  executeClarificationQuestions,
  executeCreateProposedTasks,
  executeUpdateProjectMemory,
  prepareCreateClickupDocToolRunInput,
  prepareCreateClickupTaskToolRunInput,
  prepareLinkClickupDocToTaskInput,
  toolRequiresConfirmation,
  isExternalMutationTool,
  getToolCategory,
} from "./tools.ts";
import {
  attachWorkflowToPayload,
  loadWorkflowToolRuns,
  resolveWorkflowPayload,
  stepResultFromPayload,
  topologicalSortSteps,
  type WorkflowStepMeta,
} from "./workflow.ts";
import type {
  AgentWorkflowPlan,
  AgentWorkflowStep,
  ProjectFactUpdate,
  ProjectMeetingMemory,
} from "./types.ts";
import type { ClickupDocLangSmithMeta } from "./clickupDocTool.ts";
import type {
  AgentDiagnostics,
  AgentMode,
  AgentPlan,
  AgentRunStatus,
  ProjectAgentRunInput,
} from "./types.ts";
import { isTriggerDevConfigured } from "./triggerDev.ts";
import { resolveUserClickupForProject } from "../clickup-auth.ts";
import { clickupFetch } from "../clickup.ts";
import { detectDuplicateTask } from "../task-generation/duplicateDetection.ts";
import { getSlackWorkspaceTokenOrThrow } from "../slack-auth.ts";
import { callSlackApi } from "../slack.ts";
import {
  explicitlyAllowsMentions,
  removeMentionSyntax,
  resolveExplicitLinkedReferences,
} from "./linkedReferences.ts";
import {
  detectExplicitClickupAction,
  selectClickupTaskTarget,
} from "./commentSafety.ts";

function validateAnswerSourceCitations(answer: string | null | undefined, chunks: Array<{ metadata?: Record<string, unknown> }>): string | null {
  if (!answer) return answer ?? null;
  const valid = new Set(chunks.map((chunk, index) => {
    const supplied = chunk.metadata?.citation_id;
    return typeof supplied === "string" ? supplied : `S${index + 1}`;
  }));
  return answer.replace(/\s*\[(S\d+)\]/g, (full, citation: string) => valid.has(citation) ? full : "");
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

export function meetingDateFromSourceTitle(title: string): string | null {
  const compact = title.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (compact) return validIsoDate(`${compact[1]}-${compact[2]}-${compact[3]}`);
  const separated = title.match(/(?:^|\D)(20\d{2})[-_.](\d{2})[-_.](\d{2})(?:\D|$)/);
  return separated ? validIsoDate(`${separated[1]}-${separated[2]}-${separated[3]}`) : null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function persistMeetingMemory(args: {
  admin: SupabaseClient;
  projectId: string;
  sourceId: string;
  sourceTitle: string;
  agentRunId?: string | null;
  memory: ProjectMeetingMemory;
}): Promise<void> {
  const filenameDate = meetingDateFromSourceTitle(args.sourceTitle);
  const extractedDate = validIsoDate(args.memory.meeting_date);
  const meetingOn = filenameDate ?? extractedDate;
  const meetingDateSource = filenameDate
    ? "filename"
    : extractedDate
    ? args.memory.meeting_date_source
    : "unknown";
  const { error } = await args.admin.from("project_meeting_memories").upsert({
    project_id: args.projectId,
    source_id: args.sourceId,
    agent_run_id: args.agentRunId ?? null,
    title: args.memory.title?.trim() || args.sourceTitle,
    meeting_on: meetingOn,
    meeting_date_source: meetingDateSource,
    next_meeting_on: validIsoDate(args.memory.next_meeting_date),
    cadence_signal: args.memory.cadence_signal ?? "unknown",
    summary: args.memory.summary?.trim() || "Meeting memory extracted.",
    decisions: args.memory.decisions ?? [],
    completed_or_demo: args.memory.completed_or_demo ?? [],
    current_week_focus: args.memory.current_week_focus ?? [],
    next_meeting_deliverables: args.memory.next_meeting_deliverables ?? [],
    feedback: args.memory.feedback ?? [],
    open_questions: args.memory.open_questions ?? [],
    participants: args.memory.participants ?? [],
    raw_memory: args.memory,
    extraction_version: 1,
    confidence: args.memory.confidence,
  }, { onConflict: "source_id" });
  if (error) throw new Error(`Meeting memory save failed: ${error.message}`);
}

async function refreshProjectCadence(args: {
  admin: SupabaseClient;
  projectId: string;
}): Promise<void> {
  const [{ data: memories }, { data: existing }] = await Promise.all([
    args.admin
      .from("project_meeting_memories")
      .select("meeting_on, next_meeting_on, cadence_signal")
      .eq("project_id", args.projectId)
      .not("meeting_on", "is", null)
      .order("meeting_on", { ascending: false })
      .limit(12),
    args.admin
      .from("project_operating_cadence")
      .select("cadence_type, cadence_days, timezone, source, confidence")
      .eq("project_id", args.projectId)
      .maybeSingle(),
  ]);
  const dated = (memories ?? []).filter((row) => validIsoDate(row.meeting_on));
  if (!dated.length && existing) return;

  const latest = dated[0];
  const latestDate = validIsoDate(latest?.meeting_on);
  const priorDate = validIsoDate(dated[1]?.meeting_on);
  const observedGap = latestDate && priorDate
    ? Math.round((Date.parse(`${latestDate}T00:00:00Z`) - Date.parse(`${priorDate}T00:00:00Z`)) / 86_400_000)
    : null;
  const explicitWeekly = dated.some((row) => row.cadence_signal === "weekly");
  const observedWeekly = observedGap !== null && observedGap >= 5 && observedGap <= 9;
  const cadenceDays = Number(existing?.cadence_days ?? 7);
  const nextMeeting = validIsoDate(latest?.next_meeting_on)
    ?? (latestDate ? addDays(latestDate, cadenceDays) : null);
  const weekday = latestDate ? new Date(`${latestDate}T00:00:00Z`).getUTCDay() : null;

  const { error } = await args.admin.from("project_operating_cadence").upsert({
    project_id: args.projectId,
    cadence_type: existing?.cadence_type ?? "weekly",
    cadence_days: cadenceDays,
    meeting_weekday: weekday,
    timezone: existing?.timezone ?? "Europe/Lisbon",
    last_meeting_on: latestDate,
    next_meeting_on: nextMeeting,
    source: existing?.source === "manual" ? "manual" : "meeting_memory",
    confidence: explicitWeekly || observedWeekly ? 0.98 : Number(existing?.confidence ?? 0.95),
  }, { onConflict: "project_id" });
  if (error) throw new Error(`Project cadence update failed: ${error.message}`);
}

async function persistProjectFacts(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  agentRunId: string;
  facts: ProjectFactUpdate[];
}): Promise<number> {
  const rows = args.facts
    .filter((fact) => fact.explicit_user_fact === true && fact.confidence >= 0.8)
    .map((fact) => ({
      project_id: args.projectId,
      fact_key: String(fact.fact_key ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120),
      subject: String(fact.subject ?? "").trim().slice(0, 240),
      statement: String(fact.statement ?? "").trim().slice(0, 2000),
      state: typeof fact.state === "string" ? fact.state.trim().slice(0, 120) || null : null,
      effective_on: validIsoDate(fact.effective_date),
      source_type: "user_chat",
      agent_run_id: args.agentRunId,
      evidence: { explicitly_stated_by_user: true },
      confidence: Math.min(1, Math.max(0.8, Number(fact.confidence ?? 1))),
      created_by: args.userId,
    }))
    .filter((fact) => fact.fact_key && fact.subject && fact.statement)
    .slice(0, 6);
  if (!rows.length) return 0;
  const { error } = await args.admin.from("project_state_facts").upsert(rows, {
    onConflict: "project_id,fact_key",
  });
  if (error) throw new Error(`Project fact save failed: ${error.message}`);
  return rows.length;
}

function isLikelyMeetingSource(row: Record<string, unknown>): boolean {
  if (["meeting_transcript", "zoom_transcript"].includes(String(row.source_type ?? ""))) return true;
  const title = String(row.file_name ?? row.source_title ?? "").toLowerCase();
  return /transcript|recording|meeting/.test(title) && /\.(vtt|srt|txt|md)$/.test(title);
}

async function backfillMissingMeetingMemories(args: {
  admin: SupabaseClient;
  projectId: string;
  projectName?: string | null;
  clientName?: string | null;
  agentRunId: string;
  excludeSourceIds?: string[];
  trace: TraceMetadata;
}): Promise<{ count: number; warnings: string[] }> {
  const warnings: string[] = [];
  const { data: sources, error } = await args.admin
    .from("project_knowledge_sources")
    .select("id, source_type, source_title, file_name, created_at")
    .eq("project_id", args.projectId)
    .in("source_type", ["uploaded_file", "meeting_transcript", "zoom_transcript"])
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) return { count: 0, warnings: [`Meeting-memory source lookup failed: ${error.message}`] };

  const candidates = (sources ?? [])
    .filter((row) => isLikelyMeetingSource(row as Record<string, unknown>))
    .filter((row) => !args.excludeSourceIds?.includes(String(row.id)));
  if (!candidates.length) return { count: 0, warnings };

  const sourceIds = candidates.map((row) => String(row.id));
  const { data: existingRows } = await args.admin
    .from("project_meeting_memories")
    .select("source_id")
    .in("source_id", sourceIds);
  const existing = new Set((existingRows ?? []).map((row) => String(row.source_id)));
  const missingMetadata = candidates.filter((row) => !existing.has(String(row.id))).slice(0, 2);
  if (!missingMetadata.length) return { count: 0, warnings };
  const { data: missing, error: contentError } = await args.admin
    .from("project_knowledge_sources")
    .select("id, source_type, source_title, file_name, source_text, created_at")
    .in("id", missingMetadata.map((row) => String(row.id)));
  if (contentError) {
    return { count: 0, warnings: [`Meeting-memory transcript load failed: ${contentError.message}`] };
  }

  const results = await Promise.all((missing ?? []).map(async (source) => {
    try {
      const { data: priorRun } = await args.admin
        .from("project_agent_runs")
        .select("id, raw_response, result_summary")
        .eq("project_id", args.projectId)
        .contains("created_source_ids", [String(source.id)])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sourceTitle = String(source.source_title ?? source.file_name ?? "Meeting transcript");
      const generated = await generateMeetingMemory({
        sourceTitle,
        sourceText: String(source.source_text ?? ""),
        meetingDateHint: meetingDateFromSourceTitle(sourceTitle),
        existingReview: priorRun
          ? JSON.stringify({ summary: priorRun.result_summary, review: priorRun.raw_response })
          : null,
        projectName: args.projectName,
        clientName: args.clientName,
        trace: args.trace,
      });
      await persistMeetingMemory({
        admin: args.admin,
        projectId: args.projectId,
        sourceId: String(source.id),
        sourceTitle,
        agentRunId: priorRun?.id ? String(priorRun.id) : args.agentRunId,
        memory: generated.memory,
      });
      return true;
    } catch (backfillError) {
      warnings.push(`Meeting-memory backfill failed for ${source.source_title ?? source.id}: ${(backfillError as Error).message}`);
      return false;
    }
  }));
  const count = results.filter(Boolean).length;
  if (count > 0) {
    try {
      await refreshProjectCadence({ admin: args.admin, projectId: args.projectId });
    } catch (cadenceError) {
      warnings.push((cadenceError as Error).message);
    }
  }
  return { count, warnings };
}

type ClickupTaskSnapshotItem = {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  url: string | null;
  list_name: string | null;
  assignees: string[];
  due_date: string | null;
  updated_at: string | null;
};

async function loadSlackMessageContext(args: {
  admin: SupabaseClient;
  link: Record<string, unknown> | null;
  cached: unknown[];
}): Promise<{ messages: unknown[]; source: "live" | "cached" | "unavailable"; warning?: string }> {
  const teamId = typeof args.link?.slack_team_id === "string" ? args.link.slack_team_id : "";
  const channelId = typeof args.link?.slack_channel_id === "string" ? args.link.slack_channel_id : "";
  const includeInAi = args.link?.include_in_ai !== false;
  if (!teamId || !channelId || !includeInAi) {
    return { messages: args.cached, source: args.cached.length ? "cached" : "unavailable" };
  }

  try {
    const { token } = await getSlackWorkspaceTokenOrThrow(args.admin, teamId);
    const history = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(
      token,
      "conversations.history",
      { channel: channelId, limit: 24 },
    );
    const messages = [...(history.messages ?? [])];
    const parentsWithReplies = messages
      .filter((message) => Number(message.reply_count ?? 0) > 0 && typeof message.ts === "string")
      .slice(0, 4);
    for (const parent of parentsWithReplies) {
      const replies = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(
        token,
        "conversations.replies",
        { channel: channelId, ts: parent.ts, limit: 50 },
      );
      messages.push(...(replies.messages ?? []).slice(1));
    }
    const compact = messages
      .filter((message) => typeof message.text === "string" && message.text.trim())
      .map((message) => ({
        text: String(message.text).slice(0, 800),
        user: typeof message.user === "string" ? message.user : null,
        ts: typeof message.ts === "string" ? message.ts : null,
        thread_ts: typeof message.thread_ts === "string" ? message.thread_ts : null,
        channel_id: channelId,
        channel_name: typeof args.link?.channel_name === "string" ? args.link.channel_name : null,
        link_type: typeof args.link?.link_type === "string" ? args.link.link_type : null,
      }))
      .slice(0, 36);
    return { messages: compact, source: "live" };
  } catch (error) {
    return {
      messages: args.cached,
      source: args.cached.length ? "cached" : "unavailable",
      warning: `Live Slack context check failed: ${(error as Error).message}`,
    };
  }
}

type ClickupTaskSnapshot = {
  tasks: ClickupTaskSnapshotItem[];
  source: "live" | "cached" | "unavailable";
  warnings: string[];
};

function clickupTimestamp(value: unknown): string | null {
  const millis = Number(value);
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null;
}

async function loadClickupTaskSnapshot(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  clickupConnected: boolean;
  link: Record<string, unknown> | null;
  hierarchyRows: Awaited<ReturnType<typeof getClickupProjectHierarchy>>["rows"];
}): Promise<ClickupTaskSnapshot> {
  const warnings: string[] = [];
  const loadCached = async (): Promise<ClickupTaskSnapshot> => {
    const { data, error } = await args.admin
      .from("clickup_task_links")
      .select("clickup_task_id, clickup_task_name, clickup_status, clickup_task_url, last_snapshot, last_synced_at")
      .eq("project_id", args.projectId)
      .order("last_synced_at", { ascending: false })
      .limit(200);
    if (error) warnings.push(`Cached ClickUp task lookup failed: ${error.message}`);
    const tasks = (data ?? []).map((row) => {
      const snapshot = (row.last_snapshot ?? {}) as Record<string, unknown>;
      const list = (snapshot.list ?? {}) as Record<string, unknown>;
      const assignees = Array.isArray(snapshot.assignees)
        ? snapshot.assignees.map((entry) => {
            const person = (entry ?? {}) as Record<string, unknown>;
            return String(person.username ?? person.email ?? "").trim();
          }).filter(Boolean)
        : [];
      return {
        id: String(row.clickup_task_id),
        name: String(row.clickup_task_name ?? snapshot.name ?? row.clickup_task_id),
        description: String(snapshot.text_content ?? snapshot.description ?? "").slice(0, 600) || null,
        status: row.clickup_status ? String(row.clickup_status) : null,
        url: row.clickup_task_url ? String(row.clickup_task_url) : null,
        list_name: list.name ? String(list.name) : null,
        assignees,
        due_date: clickupTimestamp(snapshot.due_date),
        updated_at: row.last_synced_at ? String(row.last_synced_at) : null,
      };
    });
    return { tasks, source: tasks.length > 0 ? "cached" : "unavailable", warnings };
  };

  if (!args.clickupConnected) return { tasks: [], source: "unavailable", warnings: ["Project is not connected to ClickUp."] };

  const linkedListId = typeof args.link?.clickup_list_id === "string" ? args.link.clickup_list_id.trim() : "";
  const linkedSpaceId = typeof args.link?.clickup_space_id === "string" ? args.link.clickup_space_id.trim() : "";
  const listRows = args.hierarchyRows.filter((row) => row.node_type === "list");
  const listIds = [...new Set((linkedListId ? [linkedListId] : listRows.map((row) => row.external_id)).filter(Boolean))].slice(0, 20);
  if (!linkedSpaceId && listIds.length === 0) {
    warnings.push("No ClickUp space or lists were available for a live task check.");
    return loadCached();
  }

  try {
    const { clickup } = await resolveUserClickupForProject(args.userId, args.projectId);
    const tasks: ClickupTaskSnapshotItem[] = [];
    const appendTasks = (pageTasks: Record<string, unknown>[], fallbackListId?: string) => {
      for (const task of pageTasks) {
        if (tasks.length >= 200) break;
        const status = (task.status ?? {}) as Record<string, unknown>;
        const list = (task.list ?? {}) as Record<string, unknown>;
        const assignees = Array.isArray(task.assignees)
          ? task.assignees.map((entry) => {
              const person = (entry ?? {}) as Record<string, unknown>;
              return String(person.username ?? person.email ?? "").trim();
            }).filter(Boolean)
          : [];
        tasks.push({
          id: String(task.id ?? ""),
          name: String(task.name ?? task.id ?? "Untitled task"),
          description: String(task.text_content ?? task.description ?? "").slice(0, 600) || null,
          status: status.status ? String(status.status) : null,
          url: task.url ? String(task.url) : null,
          list_name: list.name
            ? String(list.name)
            : fallbackListId
            ? listRows.find((row) => row.external_id === fallbackListId)?.name ?? null
            : null,
          assignees,
          due_date: clickupTimestamp(task.due_date),
          updated_at: clickupTimestamp(task.date_updated),
        });
      }
    };

    if (linkedSpaceId) {
      for (let page = 0; page < 2 && tasks.length < 200; page += 1) {
        const result = await clickupFetch(
          clickup,
          `/team/${encodeURIComponent(clickup.teamId)}/task?space_ids%5B%5D=${encodeURIComponent(linkedSpaceId)}&include_closed=true&subtasks=true&order_by=updated&page=${page}`,
        ) as { tasks?: Record<string, unknown>[]; last_page?: boolean };
        const pageTasks = Array.isArray(result.tasks) ? result.tasks : [];
        appendTasks(pageTasks);
        if (result.last_page === true || pageTasks.length === 0) break;
      }
    } else {
      for (const listId of listIds) {
        for (let page = 0; page < 2 && tasks.length < 200; page += 1) {
          const result = await clickupFetch(
            clickup,
            `/list/${encodeURIComponent(listId)}/task?archived=false&include_closed=true&subtasks=true&order_by=updated&page=${page}`,
          ) as { tasks?: Record<string, unknown>[]; last_page?: boolean };
          const pageTasks = Array.isArray(result.tasks) ? result.tasks : [];
          appendTasks(pageTasks, listId);
          if (result.last_page === true || pageTasks.length === 0) break;
        }
      }
    }
    return { tasks: tasks.filter((task) => task.id), source: "live", warnings };
  } catch (error) {
    warnings.push(`Live ClickUp task check failed: ${(error as Error).message}`);
    return loadCached();
  }
}

const FOLDER_MANAGEMENT_TOOLS = new Set([
  "create_clickup_folder",
  "rename_clickup_folder",
  "move_clickup_doc",
  "move_clickup_task",
  "archive_clickup_folder",
  "create_clickup_list",
  "rename_clickup_list",
]);

const HIERARCHY_AWARE_TOOLS = new Set([
  "create_clickup_doc",
  "create_clickup_task",
  "link_clickup_doc_to_task",
  "sync_clickup_docs",
  "sync_clickup_hierarchy",
]);

async function storeIntakeSource(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  inputText: string;
  plan: AgentPlan;
}): Promise<string | undefined> {
  if (!args.inputText.trim()) return undefined;
  const { data, error } = await args.admin
    .from("project_knowledge_sources")
    .insert({
      project_id: args.projectId,
      source_type: "agent",
      source_title: "Project agent intake",
      input_method: "text",
      char_count: args.inputText.length,
      source_text: args.inputText,
      source_preview: args.inputText.slice(0, 1000),
      metadata: { detected_intent: args.plan.detected_intent, summary: args.plan.summary },
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const chunks = chunkKnowledgeText(args.inputText, {
    targetChars: Number(Deno.env.get("AI_RETRIEVAL_CHUNK_SIZE_CHARS") ?? "2600"),
    overlapChars: Number(Deno.env.get("AI_RETRIEVAL_CHUNK_OVERLAP_CHARS") ?? "320"),
  });
  if (chunks.length > 0) {
    await args.admin.from("project_knowledge_chunks").insert(
      chunks.map((chunk, index) => ({
        project_id: args.projectId,
        source_id: data.id,
        chunk_index: index,
        content: chunk.content,
        section_path: chunk.sectionPath,
        category: "agent_intake",
        metadata: {
          source_type: "agent",
          source_title: "Project agent intake",
          section_path: chunk.sectionPath,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
          token_estimate: chunk.tokenEstimate,
          char_count: chunk.content.length,
        },
      })),
    );
  }
  return data.id;
}

async function storeUploadedFileSource(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  fileName: string;
  mimeType: string | null;
  sourceText: string;
  attachmentId: string;
}): Promise<string | undefined> {
  if (!args.sourceText.trim()) return undefined;
  const { data: existing } = await args.admin
    .from("project_knowledge_sources")
    .select("id")
    .eq("project_id", args.projectId)
    .contains("metadata", { attachment_id: args.attachmentId })
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const { data, error } = await args.admin
    .from("project_knowledge_sources")
    .insert({
      project_id: args.projectId,
      source_type: "uploaded_file",
      source_title: args.fileName,
      input_method: "file",
      file_name: args.fileName,
      mime_type: args.mimeType,
      char_count: args.sourceText.length,
      source_text: args.sourceText,
      source_preview: args.sourceText.slice(0, 1000),
      metadata: { attachment_id: args.attachmentId },
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const chunks = chunkKnowledgeText(args.sourceText, {
    targetChars: Number(Deno.env.get("AI_RETRIEVAL_CHUNK_SIZE_CHARS") ?? "2600"),
    overlapChars: Number(Deno.env.get("AI_RETRIEVAL_CHUNK_OVERLAP_CHARS") ?? "320"),
  });
  if (chunks.length > 0) {
    await args.admin.from("project_knowledge_chunks").insert(
      chunks.map((chunk, index) => ({
        project_id: args.projectId,
        source_id: data.id,
        chunk_index: index,
        content: chunk.content,
        section_path: chunk.sectionPath,
        category: "uploaded_file",
        metadata: {
          source_type: "uploaded_file",
          source_title: args.fileName,
          file_name: args.fileName,
          section_path: chunk.sectionPath,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
          token_estimate: chunk.tokenEstimate,
          char_count: chunk.content.length,
        },
      })),
    );
  }
  return data.id;
}

async function resolveUploadedIntakeFiles(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  fileIds: string[];
}): Promise<{
  combinedText: string;
  sourceIds: string[];
  sources: Array<{ sourceId: string; fileName: string; sourceText: string }>;
}> {
  if (!args.fileIds.length) return { combinedText: "", sourceIds: [], sources: [] };

  const { data: attachments, error } = await args.admin
    .from("attachments")
    .select("id, file_name, file_path, mime_type")
    .in("id", args.fileIds)
    .eq("entity_type", "project")
    .eq("entity_id", args.projectId);
  if (error) throw new Error(error.message);

  const parts: string[] = [];
  const sourceIds: string[] = [];
  const resolvedSources: Array<{ sourceId: string; fileName: string; sourceText: string }> = [];
  const textExtensions = new Set(["txt", "md", "csv", "json", "vtt", "srt"]);

  for (const att of attachments ?? []) {
    const extension = String(att.file_name ?? "").split(".").pop()?.toLowerCase() ?? "";
    const mimeType = String(att.mime_type ?? "").toLowerCase();
    const isTextFile = mimeType.startsWith("text/") ||
      ["application/json", "application/csv"].includes(mimeType) ||
      textExtensions.has(extension);
    if (!isTextFile) {
      throw new Error(
        `Unsupported chat attachment: ${att.file_name}. Upload a text transcript (TXT, MD, CSV, JSON, VTT, or SRT).`,
      );
    }
    const { data: blob, error: dlErr } = await args.admin.storage.from("documents").download(att.file_path);
    if (dlErr || !blob) continue;
    const text = (await blob.text()).trim();
    if (!text) continue;
    parts.push(`--- Uploaded file: ${att.file_name} ---\n${text}`);
    const sourceId = await storeUploadedFileSource({
      admin: args.admin,
      projectId: args.projectId,
      userId: args.userId,
      fileName: att.file_name,
      mimeType: att.mime_type,
      sourceText: text,
      attachmentId: att.id,
    });
    if (sourceId) {
      sourceIds.push(sourceId);
      resolvedSources.push({ sourceId, fileName: String(att.file_name), sourceText: text });
    }
  }

  return { combinedText: parts.join("\n\n"), sourceIds, sources: resolvedSources };
}

async function prepareToolInput(args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  projectId: string;
  agentRunId: string;
  inputText: string;
  contextBlock: string;
  hierarchyRows: Awaited<ReturnType<typeof getClickupProjectHierarchy>>["rows"];
  clickupLink: Record<string, unknown> | null;
  clickupDocToolMeta: ClickupDocLangSmithMeta[];
  trace: TraceMetadata;
}): Promise<Record<string, unknown> | null> {
  let toolInput = { ...args.toolInput };

  if (args.toolName === "create_clickup_doc") {
    const prepared = await prepareCreateClickupDocToolRunInput({
      rawInput: toolInput,
      projectId: args.projectId,
      agentRunId: args.agentRunId,
      requestText: args.inputText,
      contextBlock: args.contextBlock,
      hierarchyRows: args.hierarchyRows,
      clickupLink: args.clickupLink,
      trace: args.trace,
    });
    args.clickupDocToolMeta.push(prepared.meta);
    return prepared.input;
  }

  if (args.toolName === "create_clickup_task") {
    return prepareCreateClickupTaskToolRunInput({
      rawInput: toolInput,
      requestText: args.inputText,
      hierarchyRows: args.hierarchyRows,
      clickupLink: args.clickupLink,
    });
  }

  if (args.toolName === "add_clickup_comment") {
    const taskId = String(toolInput.task_id ?? "").trim();
    const commentText = String(toolInput.comment_text ?? "").trim();
    if (!taskId || !commentText) return null;
    const allowClientMentions = explicitlyAllowsMentions(args.inputText);
    return {
      ...toolInput,
      task_id: taskId,
      comment_text: (allowClientMentions ? commentText : removeMentionSyntax(commentText)).slice(0, 8000),
      allow_client_mentions: allowClientMentions,
      requested_by_user: true,
    };
  }

  if (args.toolName === "link_clickup_doc_to_task") {
    return prepareLinkClickupDocToTaskInput({
      rawInput: { ...toolInput, project_id: args.projectId },
      stepKey: String(toolInput.step_key ?? "link"),
    });
  }

  return toolInput;
}

async function createWorkflowToolRuns(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  agentRunId: string;
  workflow: AgentWorkflowPlan;
  inputText: string;
  contextBlock: string;
  hierarchyRows: Awaited<ReturnType<typeof getClickupProjectHierarchy>>["rows"];
  clickupLink: Record<string, unknown> | null;
  clickupDocToolMeta: ClickupDocLangSmithMeta[];
  trace: TraceMetadata;
}): Promise<{ ids: string[]; errors: string[] }> {
  const workflowId = crypto.randomUUID();
  const ids: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < args.workflow.steps.length; i++) {
    const step = args.workflow.steps[i];
    const wfMeta: WorkflowStepMeta = {
      workflow_id: workflowId,
      workflow_name: args.workflow.workflow_name,
      step_key: step.step_key,
      step_order: i + 1,
      depends_on: step.depends_on ?? [],
    };

    try {
      let toolInput = await prepareToolInput({
        toolName: step.tool_name,
        toolInput: step.input ?? {},
        projectId: args.projectId,
        agentRunId: args.agentRunId,
        inputText: args.inputText,
        contextBlock: args.contextBlock,
        hierarchyRows: args.hierarchyRows,
        clickupLink: args.clickupLink,
        clickupDocToolMeta: args.clickupDocToolMeta,
        trace: args.trace,
      });
      if (!toolInput) continue;
      toolInput = attachWorkflowToPayload(toolInput, wfMeta);

      const id = await createPendingToolRun({
        admin: args.admin,
        projectId: args.projectId,
        userId: args.userId,
        agentRunId: args.agentRunId,
        toolName: step.tool_name,
        input: toolInput,
        workflow: wfMeta,
      });
      ids.push(id);
    } catch (e) {
      errors.push(`Step ${step.step_key}: ${(e as Error).message}`);
    }
  }

  return { ids, errors };
}

export async function runProjectAgent(args: {
  admin: SupabaseClient;
  input: ProjectAgentRunInput;
  runtime?: "trigger.dev" | "edge-sync-fallback";
}): Promise<{
  status: AgentRunStatus;
  result_summary: string;
  plan: AgentPlan;
  tool_run_ids: string[];
  created_task_ids: string[];
  created_source_ids: string[];
  diagnostics: AgentDiagnostics;
}> {
  const { input } = args;
  let chatSessionId = input.chat_session_id?.trim() || null;
  if (input.chat && !chatSessionId) {
    const { data: run } = await args.admin
      .from("project_agent_runs")
      .select("chat_session_id")
      .eq("id", input.agent_run_id)
      .maybeSingle();
    chatSessionId = typeof run?.chat_session_id === "string" ? run.chat_session_id : null;
  }

  if (input.chat && !chatSessionId) {
    const { data: session, error: sessionError } = await args.admin
      .from("project_chat_sessions")
      .insert({ project_id: input.project_id, created_by: input.user_id, title: "New chat" })
      .select("id")
      .single();
    if (sessionError || !session) throw new Error(sessionError?.message ?? "Could not create chat session.");
    chatSessionId = session.id;
    await args.admin.from("project_agent_runs").update({ chat_session_id: chatSessionId }).eq("id", input.agent_run_id);
  }
  const traceHandle = await createLangfuseTrace({
    name: "projectAgentRun",
    metadata: {
      project_id: input.project_id,
      agent_run_id: input.agent_run_id,
      source: "project-agent-run",
      runtime: args.runtime ?? "edge-sync-fallback",
    },
    input: { mode: input.mode ?? "auto", has_text: !!input.input_text?.trim() },
  });

  await args.admin
    .from("project_agent_runs")
    .update({ status: "running" })
    .eq("id", input.agent_run_id);

  const inputText = (input.input_text ?? "").trim();
  const mode: AgentMode = input.mode ?? "auto";

  const fileIntake = await resolveUploadedIntakeFiles({
    admin: args.admin,
    projectId: input.project_id,
    userId: input.user_id,
    fileIds: input.uploaded_file_ids ?? [],
  });
  // File analysis is also used by durable background meeting imports. Chat
  // controls transcript publication, not whether structured meeting memory is
  // extracted and persisted.
  const isFileReview = fileIntake.sourceIds.length > 0;
  const isClarificationResponse = input.chat === true && input.chat_action === "clarification_response";
  const isTaskReview = isFileReview || isClarificationResponse;
  const embeddingWarnings: string[] = [];
  for (const sourceId of fileIntake.sourceIds) {
    try {
      await embedProjectKnowledgeChunks({
        admin: args.admin,
        projectId: input.project_id,
        sourceId,
        syncPinecone: true,
      });
    } catch (error) {
      embeddingWarnings.push(`Uploaded file embedding failed: ${(error as Error).message}`);
    }
  }
  const agentInputText = [inputText, fileIntake.combinedText].filter(Boolean).join("\n\n");

  const [
    projectRes,
    profileRes,
    attentionRes,
    tasksRes,
    pmActionsRes,
    timelineRes,
    signalsRes,
    clickupLinkRes,
    slackLinkRes,
    slackEventsRes,
  ] = await Promise.all([
    args.admin.from("projects").select("name, client_name, description, project_type").eq("id", input.project_id).maybeSingle(),
    args.admin.from("project_pm_profiles").select("*").eq("project_id", input.project_id).maybeSingle(),
    args.admin.from("project_pm_attention_items").select("*").eq("project_id", input.project_id).eq("status", "open").limit(10),
    args.admin.from("ai_proposed_tasks").select("id, title, status, priority").eq("project_id", input.project_id).eq("status", "pending").limit(20),
    args.admin.from("project_pm_action_items").select("id, title, status, priority, source_type").eq("project_id", input.project_id).in("status", ["open", "in_progress"]).limit(20),
    args.admin.from("project_timeline_events").select("event_title, event_summary, source_type, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(15),
    args.admin.from("project_signals").select("title, summary, signal_type, signal_status, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(15),
    args.admin.from("project_clickup_links").select("*").eq("project_id", input.project_id).maybeSingle(),
    args.admin
      .from("project_slack_links")
      .select("id, status, last_synced_at, last_event_ts, slack_team_id, slack_channel_id, channel_name, link_type, include_in_ai")
      .eq("project_id", input.project_id)
      .eq("status", "active")
      .eq("include_in_ai", true)
      .order("last_synced_at", { ascending: false, nullsFirst: false }),
    args.admin
      .from("project_slack_events")
      .select("slack_channel_id, message_text, message_preview, slack_user_name, slack_ts, slack_thread_ts, signal_type, created_at")
      .eq("project_id", input.project_id)
      .eq("include_in_ai", true)
      .neq("signal_type", "noise")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const projectRow = projectRes.data as
    | { name?: string | null; client_name?: string | null; description?: string | null; project_type?: string | null }
    | null;
  const meetingBackfill = input.chat
    ? await backfillMissingMeetingMemories({
        admin: args.admin,
        projectId: input.project_id,
        projectName: projectRow?.name ?? null,
        clientName: projectRow?.client_name ?? null,
        agentRunId: input.agent_run_id,
        excludeSourceIds: fileIntake.sourceIds,
        trace: {
          project_id: input.project_id,
          agent_run_id: input.agent_run_id,
          source: "project-agent-run",
          runtime: args.runtime ?? "edge-sync-fallback",
        },
      })
    : { count: 0, warnings: [] as string[] };

  const clickupConnected = !!clickupLinkRes.data;
  let hierarchyRows: Awaited<ReturnType<typeof getClickupProjectHierarchy>>["rows"] = [];
  let hierarchySummary = { folders: 0, lists: 0, docs: 0, pages: 0, last_synced_at: null as string | null };
  const hierarchyWarnings: string[] = [];

  if (clickupConnected) {
    try {
      const fresh = await ensureHierarchyFreshForTools({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
      });
      hierarchyRows = fresh.rows;
      hierarchySummary = fresh.summary;
      hierarchyWarnings.push(...fresh.syncWarnings);
    } catch (e) {
      hierarchyWarnings.push((e as Error).message);
      const cached = await getClickupProjectHierarchy({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
      });
      hierarchyRows = cached.rows;
      hierarchySummary = cached.summary;
    }
  }

  const clickupTaskSnapshot = input.chat
    ? await loadClickupTaskSnapshot({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
        clickupConnected,
        link: clickupLinkRes.data as Record<string, unknown> | null,
        hierarchyRows,
      })
    : { tasks: [] as ClickupTaskSnapshotItem[], source: "unavailable" as const, warnings: [] as string[] };
  const slackLinks = ((slackLinkRes.data ?? []) as Record<string, unknown>[]).slice(0, 6);
  const slackContexts = input.chat
    ? await Promise.all(slackLinks.map((link) => loadSlackMessageContext({
        admin: args.admin,
        link,
        cached: (slackEventsRes.data ?? []).filter((event) =>
          String((event as Record<string, unknown>).slack_channel_id ?? "") === String(link.slack_channel_id ?? "")
        ),
      })))
    : [];
  const slackContext = slackContexts.length > 0
    ? {
        messages: slackContexts.flatMap((context) => context.messages).slice(0, 72),
        source: slackContexts.some((context) => context.source === "live")
          ? "live" as const
          : slackContexts.some((context) => context.source === "cached")
            ? "cached" as const
            : "unavailable" as const,
        warning: slackContexts.flatMap((context) => context.warning ? [context.warning] : []).join(" ") || undefined,
      }
    : { messages: [] as unknown[], source: "unavailable" as const };
  const linkedReferenceResolution = input.chat
    ? await resolveExplicitLinkedReferences({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
        text: agentInputText,
        slackLinks,
        clickupLink: clickupLinkRes.data as Record<string, unknown> | null,
      })
    : { references: [], warnings: [] };

  const chatHistoryRes = input.chat
    ? await args.admin
        .from("project_chat_messages")
        .select("role, content")
        .eq("project_id", input.project_id)
        .eq("chat_session_id", chatSessionId)
        .neq("agent_run_id", input.agent_run_id)
        .order("created_at", { ascending: false })
        .limit(8)
    : { data: [] as Array<{ role: string; content: string }> };
  const chatHistory = ((chatHistoryRes.data ?? []) as Array<{ role: string; content: string }>).reverse();
  const retrievalQuery = buildHistoryAwareRetrievalQuery(
    agentInputText || "Review the current project context and summarize the current state.",
    chatHistory,
  );
  const retrieval = await retrieveProjectKnowledge({
    admin: args.admin,
    projectId: input.project_id,
    queryText: retrievalQuery,
    usePinecone: input.chat === true,
  });

  const [cadenceRes, meetingMemoriesRes, projectFactsRes] = input.chat
    ? await Promise.all([
        args.admin
          .from("project_operating_cadence")
          .select("cadence_type, cadence_days, meeting_weekday, timezone, last_meeting_on, next_meeting_on, source, confidence, updated_at")
          .eq("project_id", input.project_id)
          .maybeSingle(),
        args.admin
          .from("project_meeting_memories")
          .select("title, meeting_on, meeting_date_source, next_meeting_on, cadence_signal, summary, decisions, completed_or_demo, current_week_focus, next_meeting_deliverables, feedback, open_questions, participants, confidence, updated_at")
          .eq("project_id", input.project_id)
          .order("meeting_on", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(6),
        args.admin
          .from("project_state_facts")
          .select("fact_key, subject, statement, state, effective_on, source_type, confidence, updated_at")
          .eq("project_id", input.project_id)
          .order("updated_at", { ascending: false })
          .limit(20),
      ])
    : [{ data: null }, { data: [] }, { data: [] }];

  const cadenceRow = cadenceRes.data as Record<string, unknown> | null;
  const operatingCadence = cadenceRow
    ? {
        ...cadenceRow,
        current_cycle_start_on: cadenceRow.last_meeting_on ?? null,
        current_cycle_end_on: cadenceRow.next_meeting_on ?? null,
        next_meeting_date_kind: cadenceRow.source === "manual" ? "scheduled_or_manual" : "expected_from_cadence",
      }
    : null;

  const agentContext = {
    projectName: projectRow?.name ?? null,
    clientName: projectRow?.client_name ?? null,
    projectType: projectRow?.project_type ?? null,
    profile: profileRes.data,
    operatingCadence,
    meetingMemories: meetingMemoriesRes.data ?? [],
    projectFacts: projectFactsRes.data ?? [],
    chunks: retrieval.chunks,
    openAttention: attentionRes.data ?? [],
    proposedTasks: tasksRes.data ?? [],
    pmActions: pmActionsRes.data ?? [],
    timeline: timelineRes.data ?? [],
    signals: signalsRes.data ?? [],
    clickupConnected,
    slackConnected: slackLinks.length > 0,
    slackLinks,
    clickupHierarchy: hierarchyRows,
    clickupLink: clickupLinkRes.data as Record<string, unknown> | null,
    clickupTasks: input.chat ? clickupTaskSnapshot.tasks : undefined,
    clickupTaskSnapshotSource: input.chat ? clickupTaskSnapshot.source : undefined,
    slackMessages: input.chat ? slackContext.messages : undefined,
    slackContextSource: input.chat ? slackContext.source : undefined,
    linkedReferences: input.chat ? linkedReferenceResolution.references : undefined,
    linkedReferenceWarnings: input.chat ? linkedReferenceResolution.warnings : undefined,
    asOf: new Date().toISOString(),
    chatHistory,
    sourceFreshness: {
      latestTimelineAt: (timelineRes.data?.[0] as { created_at?: string } | undefined)?.created_at ?? null,
      latestSignalAt: (signalsRes.data?.[0] as { created_at?: string } | undefined)?.created_at ?? null,
      clickupLastSyncAt: (clickupLinkRes.data as { last_sync_at?: string | null } | null)?.last_sync_at ?? null,
      slackLastSyncAt: slackLinks
        .map((link) => typeof link.last_synced_at === "string" ? link.last_synced_at : null)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null,
    },
  };

  const explicitClickupAction = input.chat ? detectExplicitClickupAction(inputText) : null;
  const generationTrace = {
    project_id: input.project_id,
    agent_run_id: input.agent_run_id,
    source: "project-agent-run",
    runtime: args.runtime ?? "edge-sync-fallback",
    chunks_retrieved_count: retrieval.chunks.length,
    clickup_doc_chunks_retrieved: retrieval.clickup_doc_chunks_retrieved,
  };
  let plan: AgentPlan;
  let model: string;
  let usage: Awaited<ReturnType<typeof generateAgentPlan>>["usage"];
  let traceId: string | null;
  let generationId: string | null;

  if (explicitClickupAction === "add_clickup_comment") {
    const linkedTarget = linkedReferenceResolution.references.find((reference) => reference.kind === "clickup_task");
    const linkedTask = linkedTarget
      ? {
          id: String(linkedTarget.data.task_id ?? ""),
          name: String(linkedTarget.data.task_name ?? linkedTarget.data.task_id ?? "ClickUp task"),
          url: String(linkedTarget.data.task_url ?? linkedTarget.url),
        }
      : null;
    const target = linkedTask?.id
      ? linkedTask
      : selectClickupTaskTarget(inputText, clickupTaskSnapshot.tasks);
    const containsExplicitLink = /https?:\/\/[^\s]*(?:slack\.com\/archives|clickup\.com\/(?:t|task)\/)/i.test(inputText);
    const linkFailed = containsExplicitLink && linkedReferenceResolution.references.length === 0;
    const allowMentions = explicitlyAllowsMentions(inputText);

    if (linkFailed || !target) {
      const reason = linkFailed
        ? "I couldn't read the shared Slack or ClickUp link with this project's connected account. Please verify the link and integration access."
        : "I found more than one possible ClickUp task. Share the task link or use its exact task name so I can prepare the right action.";
      plan = {
        detected_intent: "add_clickup_comment",
        answer: reason,
        memory_updates: {},
        fact_updates: [],
        proposed_tasks: [],
        clarification_questions: [],
        tool_calls: [],
        workflows: [],
        summary: reason,
        confidence: 1,
      };
      model = "deterministic-clickup-action-router";
      usage = {};
      traceId = null;
      generationId = null;
    } else {
      const draft = await generateClickupCommentDraft({
        inputText,
        context: agentContext,
        targetTask: target,
        allowMentions,
        trace: generationTrace,
      });
      const safeComment = allowMentions ? draft.commentText : removeMentionSyntax(draft.commentText);
      plan = {
        detected_intent: "add_clickup_comment",
        answer: "Review and confirm the ClickUp comment below. Nothing will be posted until you confirm.",
        memory_updates: {},
        fact_updates: [],
        proposed_tasks: [],
        clarification_questions: [],
        tool_calls: [{
          tool_name: "add_clickup_comment",
          requires_confirmation: true,
          input: {
            task_id: target.id,
            task_name: target.name,
            task_url: target.url,
            comment_text: safeComment,
            allow_client_mentions: allowMentions,
            source_links: linkedReferenceResolution.references.map((reference) => reference.url),
          },
        }],
        workflows: [],
        summary: draft.summary || `Prepared a ClickUp comment for ${target.name}.`,
        confidence: draft.confidence,
      };
      model = draft.model;
      usage = draft.usage;
      traceId = draft.traceId;
      generationId = draft.generationId;
    }
  } else {
    const generated = await generateAgentPlan({
      inputText: agentInputText || "Review project context and summarize current state.",
      mode: explicitClickupAction ? "tool_request" : mode,
      trace: generationTrace,
      context: agentContext,
      isChat: input.chat === true && !explicitClickupAction,
      reviewUploadedFiles: isTaskReview,
    });
    plan = generated.plan;
    model = generated.model;
    usage = generated.usage;
    traceId = generated.traceId;
    generationId = generated.generationId;
  }
  plan.answer = validateAnswerSourceCitations(plan.answer, retrieval.chunks);

  const meetingMemoryWarnings: string[] = [];
  if (isFileReview && plan.meeting_memory && fileIntake.sources[0]) {
    try {
      await persistMeetingMemory({
        admin: args.admin,
        projectId: input.project_id,
        sourceId: fileIntake.sources[0].sourceId,
        sourceTitle: fileIntake.sources[0].fileName,
        agentRunId: input.agent_run_id,
        memory: plan.meeting_memory,
      });
      await refreshProjectCadence({ admin: args.admin, projectId: input.project_id });
    } catch (meetingError) {
      meetingMemoryWarnings.push((meetingError as Error).message);
    }
  }

  let projectFactsSaved = 0;
  if (input.chat && !isFileReview && (plan.fact_updates?.length ?? 0) > 0) {
    try {
      projectFactsSaved = await persistProjectFacts({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
        agentRunId: input.agent_run_id,
        facts: plan.fact_updates ?? [],
      });
    } catch (factError) {
      meetingMemoryWarnings.push((factError as Error).message);
    }
  }

  // Ordinary chat remains advisory, except for an explicit confirmation-gated
  // request to add a comment to an existing ClickUp task.
  if ((input.chat && !isTaskReview) || mode === "answer_only") {
    plan.memory_updates = {};
    plan.proposed_tasks = [];
    plan.workflows = [];
    const linkedTaskTargets = linkedReferenceResolution.references
      .filter((reference) => reference.kind === "clickup_task")
      .map((reference) => ({
        id: String(reference.data.task_id ?? ""),
        name: String(reference.data.task_name ?? reference.data.task_id ?? "ClickUp task"),
        url: String(reference.data.task_url ?? reference.url),
      }));
    const allowedTargets = [...clickupTaskSnapshot.tasks, ...linkedTaskTargets];
    const inputContainsSupportedLink = /https?:\/\/[^\s]*(?:slack\.com\/archives|clickup\.com\/(?:t|task)\/)/i.test(inputText);
    plan.tool_calls = explicitClickupAction && (!inputContainsSupportedLink || linkedReferenceResolution.references.length > 0)
      ? (plan.tool_calls ?? [])
        .filter((call) => call.tool_name === explicitClickupAction)
        .flatMap((call) => {
          if (explicitClickupAction !== "add_clickup_comment") return [call];
          const target = allowedTargets.find((task) => task.id === String(call.input?.task_id ?? ""));
          const rawComment = String(call.input?.comment_text ?? "").trim();
          if (!target || !rawComment) return [];
          const allowClientMentions = explicitlyAllowsMentions(inputText);
          return [{
            ...call,
            requires_confirmation: true,
            input: {
              ...call.input,
              task_id: target.id,
              task_name: target.name,
              task_url: target.url,
              comment_text: allowClientMentions ? rawComment : removeMentionSyntax(rawComment),
              allow_client_mentions: allowClientMentions,
              source_links: linkedReferenceResolution.references.map((reference) => reference.url),
            },
          }];
        })
        .slice(0, 1)
      : [];
    if (explicitClickupAction === "create_clickup_task") {
      plan.tool_calls = (plan.tool_calls ?? []).filter((call) => {
        const title = String(call.input?.title ?? "").trim();
        if (!title || clickupTaskSnapshot.source === "unavailable") return false;
        return !detectDuplicateTask({
          request: `${title}\n${String(call.input?.description ?? "")}`,
          proposedTitle: title,
          existingTasks: clickupTaskSnapshot.tasks.map((task) => ({
            id: task.id,
            title: task.name,
            status: task.status ?? undefined,
            source: task.url ?? undefined,
          })),
        }).is_duplicate;
      });
    }
    if (explicitClickupAction && (plan.tool_calls?.length ?? 0) > 0) {
      plan.answer = "Review and confirm the proposed ClickUp action below. Nothing will run until you confirm.";
    } else if (explicitClickupAction && !plan.answer?.trim()) {
      plan.answer = "I couldn't prepare a safe ClickUp action. Check the connected task or provide its exact link.";
    }
  }
  if (isTaskReview) {
    plan.memory_updates = {};
    plan.proposed_tasks = [];
    plan.workflows = [];
    plan.tool_calls = clickupTaskSnapshot.source === "unavailable"
      ? []
      : (plan.tool_calls ?? [])
        .filter((call) => call.tool_name === "create_clickup_task")
        .filter((call) => {
          const title = typeof call.input?.title === "string" ? call.input.title : "";
          if (!title.trim()) return false;
          return !detectDuplicateTask({
            request: `${title}\n${String(call.input?.description ?? "")}`,
            proposedTitle: title,
            existingTasks: clickupTaskSnapshot.tasks.map((task) => ({
              id: task.id,
              title: task.name,
              status: task.status ?? undefined,
              source: task.url ?? undefined,
            })),
          }).is_duplicate;
        })
        .slice(0, 6);
  }

  const toolRunIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdSourceIds: string[] = [...fileIntake.sourceIds];

  let sourceId: string | undefined;
  if (inputText && (!input.chat || isClarificationResponse) && (mode !== "answer_only" || Object.keys(plan.memory_updates ?? {}).length > 0)) {
    sourceId = await storeIntakeSource({
      admin: args.admin,
      projectId: input.project_id,
      userId: input.user_id,
      inputText,
      plan,
    });
    if (sourceId) createdSourceIds.push(sourceId);
    if (sourceId) {
      try {
        await embedProjectKnowledgeChunks({
          admin: args.admin,
          projectId: input.project_id,
          sourceId,
          syncPinecone: true,
        });
      } catch (error) {
        embeddingWarnings.push(`Agent intake embedding failed: ${(error as Error).message}`);
      }
    }
  }

  const hasMemoryUpdates = plan.memory_updates && Object.keys(plan.memory_updates).length > 0;
  if (hasMemoryUpdates && mode !== "answer_only") {
    const { data: suppressedRows } = await args.admin
      .from("project_pm_attention_items")
      .select("question, status")
      .eq("project_id", input.project_id)
      .in("status", ["skipped", "cleared", "answered"]);

    await executeUpdateProjectMemory({
      admin: args.admin,
      projectId: input.project_id,
      userId: input.user_id,
      memoryUpdates: plan.memory_updates!,
      sourceId,
      suppressedQuestionKeys: buildSuppressedQuestionKeys(suppressedRows ?? []),
    });
  }

  if (plan.proposed_tasks && plan.proposed_tasks.length > 0 && mode !== "answer_only") {
    const ids = await executeCreateProposedTasks({
      admin: args.admin,
      projectId: input.project_id,
      userId: input.user_id,
      tasks: plan.proposed_tasks,
      sourceId,
    });
    createdTaskIds.push(...ids);
  }

  // Reconcile existing open PM Attention questions against the new context so
  // questions that are now answered get resolved instead of lingering.
  let reconciliation: AttentionReconciliationResult | null = null;
  if ((mode !== "answer_only" || isClarificationResponse) && agentInputText.trim()) {
    try {
      reconciliation = await reconcileProjectAttentionItems({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
        newContextText: [plan.summary, agentInputText].filter(Boolean).join("\n\n"),
        updatedMemory: hasMemoryUpdates ? plan.memory_updates : (profileRes.data as Record<string, unknown> | null),
        sourceIds: createdSourceIds,
        sourceType: isFileReview ? "meeting_transcript" : "agent_intake",
        sourceTitle: isFileReview ? "Meeting review" : isClarificationResponse ? "Clarification response" : "Project agent intake",
        projectName: projectRow?.name ?? null,
        clientName: projectRow?.client_name ?? null,
        agentRunId: input.agent_run_id,
        trace: {
          project_id: input.project_id,
          agent_run_id: input.agent_run_id,
          source: "project-agent-run",
          runtime: args.runtime ?? "edge-sync-fallback",
        },
      });
    } catch (e) {
      console.warn("[project-agent-run] attention reconciliation failed:", (e as Error).message);
    }
  }

  const contextBlock = buildAgentContextBlock(agentContext);
  const clickupDocToolMeta: ClickupDocLangSmithMeta[] = [];
  const skippedDocToolErrors: string[] = [];
  // Tool calls that were planned but not turned into a tool run, with the reason why.
  const rejectedToolCalls: Array<{ tool_name: string; reason: string }> = [];
  let hasPendingSideEffect = false;
  let workflowStepCount = 0;
  const traceMeta: TraceMetadata = {
    project_id: input.project_id,
    agent_run_id: input.agent_run_id,
    source: "project-agent-run",
    runtime: args.runtime ?? "edge-sync-fallback",
  };

  for (const workflow of plan.workflows ?? []) {
    if (!workflow.steps?.length) continue;
    workflowStepCount += workflow.steps.length;
    const { ids, errors } = await createWorkflowToolRuns({
      admin: args.admin,
      projectId: input.project_id,
      userId: input.user_id,
      agentRunId: input.agent_run_id,
      workflow,
      inputText,
      contextBlock,
      hierarchyRows,
      clickupLink: clickupLinkRes.data as Record<string, unknown> | null,
      clickupDocToolMeta,
      trace: traceMeta,
    });
    toolRunIds.push(...ids);
    skippedDocToolErrors.push(...errors);
    if (ids.length > 0) hasPendingSideEffect = true;
  }

  for (const tc of plan.tool_calls ?? []) {
    if (!tc.tool_name) continue;

    // Safe read-only tool: the hierarchy is already provided in context, so there is
    // nothing to run and nothing to confirm. Not a rejection.
    if (tc.tool_name === "read_clickup_hierarchy") {
      continue;
    }

    if (FOLDER_MANAGEMENT_TOOLS.has(tc.tool_name) && !/folder|list|rename|move|archive|reorganiz/i.test(inputText)) {
      console.warn("[project-agent-run] skipping folder tool without explicit user request:", tc.tool_name);
      rejectedToolCalls.push({
        tool_name: tc.tool_name,
        reason: "Folder/list management is only performed when the user explicitly asks to reorganize ClickUp structure.",
      });
      continue;
    }

    if (HIERARCHY_AWARE_TOOLS.has(tc.tool_name) && clickupConnected && hierarchyRows.length === 0) {
      try {
        await syncClickupProjectHierarchy({
          admin: args.admin,
          projectId: input.project_id,
          userId: input.user_id,
          force: true,
        });
        const refreshed = await getClickupProjectHierarchy({
          admin: args.admin,
          projectId: input.project_id,
          userId: input.user_id,
        });
        hierarchyRows = refreshed.rows;
        hierarchySummary = refreshed.summary;
      } catch (e) {
        hierarchyWarnings.push((e as Error).message);
      }
    }

    try {
      const toolInput = await prepareToolInput({
        toolName: tc.tool_name,
        toolInput: tc.input ?? {},
        projectId: input.project_id,
        agentRunId: input.agent_run_id,
        inputText,
        contextBlock,
        hierarchyRows,
        clickupLink: clickupLinkRes.data as Record<string, unknown> | null,
        clickupDocToolMeta,
        trace: traceMeta,
      });
      if (!toolInput) {
        rejectedToolCalls.push({
          tool_name: tc.tool_name,
          reason: "Tool input could not be prepared (missing or invalid fields).",
        });
        continue;
      }

      const id = await createPendingToolRun({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
        agentRunId: input.agent_run_id,
        toolName: tc.tool_name,
        input: toolInput,
      });
      toolRunIds.push(id);
      if (toolRequiresConfirmation(tc.tool_name)) hasPendingSideEffect = true;
    } catch (e) {
      const message = (e as Error).message;
      if (tc.tool_name === "create_clickup_doc") {
        skippedDocToolErrors.push(message);
      } else {
        console.warn("[project-agent-run] skipped tool", tc.tool_name, message);
      }
      rejectedToolCalls.push({ tool_name: tc.tool_name, reason: message });
    }
  }

  if (skippedDocToolErrors.length > 0) {
    plan.clarification_questions = [
      ...(plan.clarification_questions ?? []),
      {
        question:
          "The ClickUp document draft could not be generated with enough content. Retry with more detail, paste an outline, or ask for a specific section to expand.",
        reason: skippedDocToolErrors[0],
        importance: "high" as const,
        blocks_task_creation: false,
      },
    ].slice(0, 3);
  }

  if (plan.clarification_questions && plan.clarification_questions.length > 0) {
    await executeClarificationQuestions({
      admin: args.admin,
      projectId: input.project_id,
      userId: input.user_id,
      questions: plan.clarification_questions,
      agentRunId: input.agent_run_id,
      sourceId: sourceId ?? fileIntake.sourceIds[0],
    });
  }

  let status: AgentRunStatus = "succeeded";
  if (hasPendingSideEffect) status = "needs_confirmation";
  else if ((plan.clarification_questions?.length ?? 0) > 0 || skippedDocToolErrors.length > 0) {
    status = "needs_clarification";
  }

  const baseSummary = skippedDocToolErrors.length > 0 && toolRunIds.length === 0
    ? `Could not prepare ClickUp document: ${skippedDocToolErrors[0]}`
  : hasPendingSideEffect
    ? (plan.summary || plan.answer || "Review the pending confirmations below before anything is created in ClickUp.")
    : (plan.summary || plan.answer || "Agent run completed.");

  const reconciliationParts: string[] = [];
  if (reconciliation?.resolved_count) {
    reconciliationParts.push(
      `Resolved ${reconciliation.resolved_count} open question${reconciliation.resolved_count === 1 ? "" : "s"} from the ${input.uploaded_file_ids?.length ? "transcript" : "new context"}.`,
    );
  }
  if (reconciliation?.updated_count) {
    reconciliationParts.push(`Narrowed ${reconciliation.updated_count} question${reconciliation.updated_count === 1 ? "" : "s"}.`);
  }
  if (reconciliation?.new_questions_count) {
    reconciliationParts.push(`Added ${reconciliation.new_questions_count} new question${reconciliation.new_questions_count === 1 ? "" : "s"}.`);
  }
  const resultSummary = reconciliationParts.length > 0
    ? `${baseSummary} ${reconciliationParts.join(" ")}`.trim()
    : baseSummary;

  // Accurate tool-call accounting by category (drives the external-action warning).
  const plannedToolNames = [
    ...(plan.tool_calls ?? []).map((t) => t.tool_name),
    ...(plan.workflows ?? []).flatMap((w) => (w.steps ?? []).map((s) => s.tool_name)),
  ];
  const totalToolCallsPlanned = plannedToolNames.length;
  const externalMutationPlanned = plannedToolNames.filter((n) => isExternalMutationTool(n)).length;
  const confirmationRequiredPlanned = plannedToolNames.filter((n) => toolRequiresConfirmation(n)).length;
  const safeToolCallsPlanned = plannedToolNames.filter((n) => {
    const c = getToolCategory(n);
    return c === "safe_read" || c === "safe_internal";
  }).length;
  // rejectedToolCalls already includes create_clickup_doc failures; workflow-step
  // failures remain surfaced via diagnostics.warnings.
  const toolValidationErrors = rejectedToolCalls;

  console.info("[project-agent-run] tool accounting", {
    agent_run_id: input.agent_run_id,
    parsed_tool_calls: plannedToolNames,
    total_tool_calls_planned: totalToolCallsPlanned,
    safe_tool_calls_planned: safeToolCallsPlanned,
    external_mutation_tool_calls_planned: externalMutationPlanned,
    confirmation_required_tool_calls_planned: confirmationRequiredPlanned,
    tool_calls_created: toolRunIds.length,
    tool_calls_rejected: rejectedToolCalls.length,
    proposed_tasks_created: createdTaskIds.length,
    clickup_connected: clickupConnected,
    clickup_hierarchy_known: { folders: hierarchySummary.folders, lists: hierarchySummary.lists, docs: hierarchySummary.docs },
  });

  const resolvedTraceId = traceId ?? traceHandle?.traceId ?? null;
  const diagnostics: AgentDiagnostics = {
    model,
    retrieval_mode: retrieval.mode,
    chunks_retrieved_count: retrieval.chunks.length,
    clickup_doc_chunks_retrieved: retrieval.clickup_doc_chunks_retrieved,
    active_clickup_doc_sources: retrieval.active_clickup_doc_sources,
    excluded_out_of_scope_sources: retrieval.excluded_out_of_scope_sources,
    embeddings_enabled: retrieval.embeddings_enabled,
    embedding_provider: retrieval.embedding_provider,
    embedding_skip_reason: retrieval.embedding_skip_reason,
    pinecone_configured: retrieval.pinecone_configured,
    pinecone_used: retrieval.pinecone_used,
    pinecone_queried: retrieval.pinecone_queried,
    pinecone_matches: retrieval.pinecone_matches,
    pinecone_candidates: retrieval.pinecone_candidates,
    pinecone_reranked: retrieval.pinecone_reranked,
    pinecone_mode: retrieval.pinecone_mode,
    pinecone_shadow_overlap: retrieval.pinecone_shadow_overlap,
    retrieval_query: retrieval.retrieval_query,
    pinecone_error: retrieval.pinecone_error,
    pinecone_index: retrieval.pinecone_index,
    pinecone_namespace: retrieval.pinecone_namespace,
    openrouter_prompt_tokens: usage.prompt_tokens,
    openrouter_completion_tokens: usage.completion_tokens,
    openrouter_total_tokens: usage.total_tokens,
    openrouter_cached_tokens: usage.prompt_tokens_details?.cached_tokens,
    openrouter_cost: usage.cost,
    langfuse_trace_id: resolvedTraceId ?? undefined,
    langfuse_generation_id: generationId ?? undefined,
    langfuse_trace_url: buildLangfuseTraceUrl(resolvedTraceId),
    langfuse_enabled: isLangfuseEnabled(),
    clickup_hierarchy_last_synced: hierarchySummary.last_synced_at,
    clickup_folders_known: hierarchySummary.folders,
    clickup_lists_known: hierarchySummary.lists,
    clickup_docs_known: retrieval.active_clickup_doc_sources ?? hierarchySummary.docs,
    runtime: args.runtime ?? "edge-sync-fallback",
    trigger_configured: isTriggerDevConfigured(),
    tool_calls_planned_count: totalToolCallsPlanned,
    pending_tool_runs_count: toolRunIds.length,
    workflow_step_count: workflowStepCount > 0 ? workflowStepCount : undefined,
    clickup_connected: clickupConnected,
    file_review: isFileReview,
    clickup_tasks_checked: input.chat ? clickupTaskSnapshot.tasks.length : undefined,
    clickup_task_snapshot_source: input.chat ? clickupTaskSnapshot.source : undefined,
    meeting_memories_loaded: input.chat ? (meetingMemoriesRes.data?.length ?? 0) + (isFileReview && plan.meeting_memory ? 1 : 0) : undefined,
    meeting_memories_backfilled: input.chat ? meetingBackfill.count : undefined,
    operating_cadence_days: input.chat ? Number(cadenceRow?.cadence_days ?? 7) : undefined,
    project_facts_saved: input.chat ? projectFactsSaved : undefined,
    total_tool_calls_planned: totalToolCallsPlanned,
    safe_tool_calls_planned: safeToolCallsPlanned,
    external_mutation_tool_calls_planned: externalMutationPlanned,
    confirmation_required_tool_calls_planned: confirmationRequiredPlanned,
    tool_calls_created: toolRunIds.length,
    tool_calls_rejected: rejectedToolCalls.length,
    rejected_tool_call_reasons: rejectedToolCalls.length > 0 ? rejectedToolCalls : undefined,
    tool_validation_errors: toolValidationErrors.length > 0 ? toolValidationErrors : undefined,
    proposed_tasks_created_count: createdTaskIds.length,
    attention_reconciliation_ran: reconciliation?.ran ?? false,
    attention_open_before: reconciliation?.open_before,
    attention_resolved_count: reconciliation?.resolved_count,
    attention_updated_count: reconciliation?.updated_count,
    attention_kept_open_count: reconciliation?.kept_open_count,
    attention_new_questions_count: reconciliation?.new_questions_count,
    attention_resolved_item_ids: reconciliation?.resolved_item_ids && reconciliation.resolved_item_ids.length > 0
      ? reconciliation.resolved_item_ids
      : undefined,
    warnings: [
      ...hierarchyWarnings,
      ...skippedDocToolErrors,
      ...embeddingWarnings,
      ...meetingBackfill.warnings,
      ...meetingMemoryWarnings,
      ...clickupTaskSnapshot.warnings,
      ...linkedReferenceResolution.warnings,
      ...(slackContext.warning ? [slackContext.warning] : []),
      ...(retrieval.embeddings_enabled === false
        ? [`Embeddings disabled (${retrieval.embedding_skip_reason ?? "not configured"}), using fallback retrieval.`]
        : []),
    ].filter(Boolean).length > 0
      ? [
          ...hierarchyWarnings,
          ...skippedDocToolErrors,
          ...embeddingWarnings,
          ...meetingBackfill.warnings,
          ...meetingMemoryWarnings,
          ...clickupTaskSnapshot.warnings,
          ...linkedReferenceResolution.warnings,
          ...(slackContext.warning ? [slackContext.warning] : []),
          ...(retrieval.embeddings_enabled === false
            ? [`Embeddings disabled (${retrieval.embedding_skip_reason ?? "not configured"}), using fallback retrieval.`]
            : []),
        ]
      : undefined,
  };

  if (resolvedTraceId) {
    await patchLangfuseTrace(resolvedTraceId, {
      output: {
        status,
        summary: resultSummary,
        tool_runs: toolRunIds.length,
        workflow_steps: workflowStepCount,
        detected_intent: plan.detected_intent,
        structured_tool_calls: (plan.tool_calls ?? []).map((tc) => ({
          tool_name: tc.tool_name,
          input_keys: Object.keys(tc.input ?? {}),
          destination: (tc.input?.destination as { path?: string } | undefined)?.path,
        })),
        create_clickup_doc: clickupDocToolMeta.length > 0
          ? clickupDocToolMeta
          : skippedDocToolErrors.length > 0
          ? { skipped: true, errors: skippedDocToolErrors }
          : undefined,
        total_tool_calls_planned: totalToolCallsPlanned,
        confirmation_required_tool_calls_planned: confirmationRequiredPlanned,
        external_mutation_tool_calls_planned: externalMutationPlanned,
        tool_calls_created: toolRunIds.length,
        tool_validation_errors: toolValidationErrors.length > 0 ? toolValidationErrors : undefined,
        proposed_tasks_created_count: createdTaskIds.length,
        clickup_hierarchy_available: {
          connected: clickupConnected,
          folders: hierarchySummary.folders,
          lists: hierarchySummary.lists,
          docs: hierarchySummary.docs,
        },
      },
      metadata: {
        project_id: input.project_id,
        agent_run_id: input.agent_run_id,
        model,
      },
    });
  }

  // Persist the visible chat result before publishing a terminal run status.
  // The browser polls the run and stops as soon as it becomes terminal; doing
  // this in the opposite order creates a race where the final message/action
  // card is inserted just after the browser's last refresh.
  if (input.chat) {
    const assistantContent = (plan.answer || resultSummary).trim();
    const chatMessageMetadata = {
      status,
      file_review: isFileReview,
      clarification_questions: plan.clarification_questions ?? [],
      tool_run_ids: toolRunIds,
      clickup_tasks_checked: input.chat ? clickupTaskSnapshot.tasks.length : undefined,
      clickup_task_snapshot_source: input.chat ? clickupTaskSnapshot.source : undefined,
      memory_provider: retrieval.pinecone_used ? "pinecone" : "supabase",
      memory_matches: retrieval.chunks.length,
      memory_citations: retrieval.chunks.map((chunk, index) => ({
        id: typeof chunk.metadata?.citation_id === "string" ? chunk.metadata.citation_id : `S${index + 1}`,
        source_id: chunk.source_id,
        source_title: chunk.metadata?.source_title ?? null,
        source_type: chunk.metadata?.source_type ?? chunk.category ?? null,
        section_path: chunk.metadata?.section_path ?? null,
        canonical_url: chunk.metadata?.canonical_url ?? null,
      })),
      memory_sources: [...new Set(retrieval.chunks.flatMap((chunk) => {
        const title = chunk.metadata?.source_title;
        return typeof title === "string" && title.trim() ? [title.trim()] : [];
      }))].slice(0, 4),
    };
    if (assistantContent) {
      const { data: existingMessage } = await args.admin
        .from("project_chat_messages")
        .select("id")
        .eq("agent_run_id", input.agent_run_id)
        .eq("role", "assistant")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingMessage?.id) {
        const { error: messageError } = await args.admin
          .from("project_chat_messages")
          .update({ content: assistantContent, metadata: chatMessageMetadata })
          .eq("id", existingMessage.id);
        if (messageError) throw new Error(`Could not update assistant chat response: ${messageError.message}`);
      } else {
        const { error: messageError } = await args.admin.from("project_chat_messages").insert({
          project_id: input.project_id,
          chat_session_id: chatSessionId,
          user_id: null,
          role: "assistant",
          content: assistantContent,
          agent_run_id: input.agent_run_id,
          metadata: chatMessageMetadata,
        });
        if (messageError) throw new Error(`Could not save assistant chat response: ${messageError.message}`);
      }
    }
  }

  const { error: runCompletionError } = await args.admin
    .from("project_agent_runs")
    .update({
      status,
      detected_intent: plan.detected_intent,
      result_summary: resultSummary,
      clarification_questions: plan.clarification_questions ?? [],
      tool_run_ids: toolRunIds,
      created_source_ids: createdSourceIds,
      created_task_ids: createdTaskIds,
      raw_response: { ...plan, tool_validation_errors: toolValidationErrors },
      diagnostics,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.agent_run_id);
  if (runCompletionError) throw new Error(`Could not finalize agent run: ${runCompletionError.message}`);

  return {
    status,
    result_summary: resultSummary,
    plan,
    tool_run_ids: toolRunIds,
    created_task_ids: createdTaskIds,
    created_source_ids: createdSourceIds,
    diagnostics,
  };
}

export async function executeConfirmedToolRun(args: {
  admin: SupabaseClient;
  toolRunId: string;
  userId: string;
  inputOverrides?: Record<string, unknown>;
  skipAgentRunStatusUpdate?: boolean;
  allowRunning?: boolean;
}): Promise<{ result: Record<string, unknown>; tool_name: string }> {
  const { data: toolRun, error } = await args.admin
    .from("agent_tool_runs")
    .select("*")
    .eq("id", args.toolRunId)
    .single();
  if (error || !toolRun) throw new Error("Tool run not found.");

  if (toolRun.user_id && toolRun.user_id !== args.userId) {
    throw new Error("Not authorized to confirm this tool run.");
  }
  const trustedWorkerContinuation = args.allowRunning === true && toolRun.status === "running";
  if (!trustedWorkerContinuation && !isConfirmableAgentToolRun(toolRun)) {
    throw new Error(`Tool run is not confirmable (status=${toolRun.status}).`);
  }

  let payload = {
    ...(toolRun.input_payload as Record<string, unknown>),
    ...(args.inputOverrides ?? {}),
  };

  // Mention permission is attached server-side from the original request and
  // cannot be elevated by an edited confirmation payload.
  if (toolRun.tool_name === "add_clickup_comment") {
    payload.allow_client_mentions = (toolRun.input_payload as Record<string, unknown>).allow_client_mentions === true;
  }

  if (toolRun.tool_name === "create_clickup_doc") {
    payload = mergeAndValidateClickupDocPayload(
      toolRun.input_payload as Record<string, unknown>,
      args.inputOverrides,
    );
  }

  await args.admin
    .from("agent_tool_runs")
    .update({
      status: "running",
      confirmed_at: new Date().toISOString(),
      input_payload: payload,
      started_at: new Date().toISOString(),
      error_message: null,
      result_payload: null,
      completed_at: null,
    })
    .eq("id", args.toolRunId);

  let result: Record<string, unknown> = {};

  try {
    switch (toolRun.tool_name) {
      case "create_clickup_task": {
        const { executeCreateClickupTaskFromToolRun } = await import("./executeTools.ts");
        result = await executeCreateClickupTaskFromToolRun({
          admin: args.admin,
          projectId: toolRun.project_id,
          userId: args.userId,
          payload,
        });
        break;
      }
      case "add_clickup_comment": {
        const { executeAddClickupCommentFromToolRun } = await import("./executeTools.ts");
        result = await executeAddClickupCommentFromToolRun({
          admin: args.admin,
          projectId: toolRun.project_id,
          userId: args.userId,
          payload,
        });
        break;
      }
      case "create_clickup_doc": {
        const { executeCreateClickupDocFromToolRun } = await import("./executeTools.ts");
        result = await executeCreateClickupDocFromToolRun({
          admin: args.admin,
          projectId: toolRun.project_id,
          userId: args.userId,
          payload,
        });
        break;
      }
      case "link_clickup_doc_to_task": {
        const { executeLinkClickupDocToTaskFromToolRun } = await import("./executeTools.ts");
        result = await executeLinkClickupDocToTaskFromToolRun({
          admin: args.admin,
          projectId: toolRun.project_id,
          userId: args.userId,
          payload: { ...payload, project_id: toolRun.project_id },
        });
        break;
      }
      case "sync_clickup_docs": {
        const { executeSyncClickupDocsFromToolRun } = await import("./executeTools.ts");
        result = await executeSyncClickupDocsFromToolRun({
          admin: args.admin,
          projectId: toolRun.project_id,
          userId: args.userId,
        });
        break;
      }
      case "sync_clickup_hierarchy": {
        result = await syncClickupProjectHierarchy({
          admin: args.admin,
          projectId: toolRun.project_id,
          userId: args.userId,
          force: true,
        }) as unknown as Record<string, unknown>;
        break;
      }
      case "sync_slack_channel": {
        result = { message: "Use slack-sync-project-channel edge function for full sync.", deferred: true };
        break;
      }
      default: {
        if (FOLDER_MANAGEMENT_TOOLS.has(toolRun.tool_name)) {
          const { executeFolderManagementTool } = await import("../clickupFolderTools.ts");
          result = await executeFolderManagementTool({
            admin: args.admin,
            projectId: toolRun.project_id,
            userId: args.userId,
            toolName: toolRun.tool_name,
            payload,
          });
        } else {
          result = { message: `Tool ${toolRun.tool_name} executed as no-op.` };
        }
      }
    }

    await args.admin
      .from("agent_tool_runs")
      .update({
        status: "succeeded",
        result_payload: result,
        completed_at: new Date().toISOString(),
      })
      .eq("id", args.toolRunId);

    if (toolRun.agent_run_id && !args.skipAgentRunStatusUpdate) {
      await args.admin
        .from("project_agent_runs")
        .update({ status: "succeeded", completed_at: new Date().toISOString() })
        .eq("id", toolRun.agent_run_id);
    }

    return { result, tool_name: toolRun.tool_name };
  } catch (e) {
    const message = (e as Error).message;
    await args.admin
      .from("agent_tool_runs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", args.toolRunId);
    throw e;
  }
}

export async function executeAgentWorkflow(args: {
  admin: SupabaseClient;
  workflowId: string;
  projectId: string;
  userId: string;
  stepOverrides?: Record<string, Record<string, unknown>>;
}): Promise<{
  workflow_id: string;
  steps_completed: number;
  step_results: Array<{ step_key: string; tool_name: string; status: string; result?: Record<string, unknown> }>;
  trigger_run_id?: string;
}> {
  const runs = await loadWorkflowToolRuns({
    admin: args.admin,
    workflowId: args.workflowId,
    projectId: args.projectId,
  });
  if (runs.length === 0) throw new Error("Workflow not found.");

  const sortable = runs.map((r) => ({
    ...r,
    step_key: r.step_key ?? String(r.id),
    depends_on: r.depends_on ?? [],
  }));
  const ordered = topologicalSortSteps(sortable);
  const stepResults = new Map<string, ReturnType<typeof stepResultFromPayload>>();
  const results: Array<{ step_key: string; tool_name: string; status: string; result?: Record<string, unknown> }> = [];

  for (const step of ordered) {
    const overrides = args.stepOverrides?.[step.step_key] ?? {};
    let payload = resolveWorkflowPayload(
      { ...step.input_payload, ...overrides },
      stepResults,
    );

    if (step.tool_name === "create_clickup_doc") {
      payload = mergeAndValidateClickupDocPayload(step.input_payload, overrides);
      payload = resolveWorkflowPayload(payload, stepResults);
    }

    if (step.tool_name === "link_clickup_doc_to_task") {
      payload = resolveWorkflowPayload(
        { ...payload, project_id: args.projectId },
        stepResults,
      );
    }

    await args.admin
      .from("agent_tool_runs")
      .update({
        status: "needs_confirmation",
        input_payload: payload,
        error_message: null,
      })
      .eq("id", step.id);

    try {
      const { result } = await executeConfirmedToolRun({
        admin: args.admin,
        toolRunId: step.id,
        userId: args.userId,
        inputOverrides: payload,
        skipAgentRunStatusUpdate: true,
      });
      const normalized = stepResultFromPayload(step.tool_name, result);
      stepResults.set(step.step_key, normalized);
      results.push({ step_key: step.step_key, tool_name: step.tool_name, status: "succeeded", result });
    } catch (e) {
      const message = (e as Error).message;
      results.push({ step_key: step.step_key, tool_name: step.tool_name, status: "failed" });
      throw new Error(`Workflow stopped at step "${step.step_key}": ${message}`);
    }
  }

  const agentRunId = (await args.admin
    .from("agent_tool_runs")
    .select("agent_run_id")
    .eq("id", ordered[0]?.id)
    .maybeSingle()).data?.agent_run_id;

  if (agentRunId) {
    await args.admin
      .from("project_agent_runs")
      .update({ status: "succeeded", completed_at: new Date().toISOString() })
      .eq("id", agentRunId);
  }

  return {
    workflow_id: args.workflowId,
    steps_completed: results.length,
    step_results: results,
  };
}
