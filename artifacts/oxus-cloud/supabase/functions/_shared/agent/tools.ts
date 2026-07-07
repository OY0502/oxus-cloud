import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AgentPlan, AgentToolName } from "./types.ts";
import { generateClickupDocMarkdown } from "./aiModel.ts";
import type { TraceMetadata } from "./types.ts";
import {
  findSimilarDoc,
  suggestDocDestination,
  suggestTaskDestination,
  type ClickupHierarchyRow,
} from "../clickupHierarchy.ts";
import {
  CLICKUP_DOC_MIN_CONTENT_LENGTH,
  clickupDocLangSmithMeta,
  createClickupDocPayloadForStorage,
  logClickupDocToolPayload,
  normalizeCreateClickupDocPayload,
  validateCreateClickupDocPayload,
  type ClickupDocLangSmithMeta,
} from "./clickupDocTool.ts";

export type ToolDefinition = {
  name: AgentToolName;
  description: string;
  requires_confirmation: boolean;
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  { name: "update_project_memory", description: "Merge intake into durable project PM memory.", requires_confirmation: false },
  { name: "create_proposed_tasks", description: "Create ai_proposed_tasks rows for PM review.", requires_confirmation: false },
  { name: "create_clickup_task", description: "Create a ClickUp task after user confirmation.", requires_confirmation: true },
  { name: "create_clickup_doc", description: "Create a ClickUp doc after user confirmation.", requires_confirmation: true },
  { name: "link_clickup_doc_to_task", description: "Link a ClickUp doc to a task after user confirmation.", requires_confirmation: true },
  { name: "sync_clickup_docs", description: "Sync ClickUp docs into project knowledge (explicit user action).", requires_confirmation: true },
  { name: "sync_slack_channel", description: "Sync linked Slack channel history.", requires_confirmation: false },
  { name: "ask_clarification_questions", description: "Surface up to 3 clarification questions.", requires_confirmation: false },
  { name: "answer_project_question", description: "Answer from project context without side effects.", requires_confirmation: false },
  { name: "read_clickup_hierarchy", description: "Read cached ClickUp folder/list/doc hierarchy.", requires_confirmation: false },
  { name: "sync_clickup_hierarchy", description: "Refresh ClickUp hierarchy cache from API.", requires_confirmation: true },
  { name: "create_clickup_folder", description: "Create a ClickUp folder (explicit user request only).", requires_confirmation: true },
  { name: "rename_clickup_folder", description: "Rename a ClickUp folder (explicit user request only).", requires_confirmation: true },
  { name: "move_clickup_doc", description: "Move a ClickUp doc to another parent (explicit user request only).", requires_confirmation: true },
  { name: "move_clickup_task", description: "Move a ClickUp task to another list (explicit user request only).", requires_confirmation: true },
  { name: "archive_clickup_folder", description: "Archive a ClickUp folder (explicit user request only).", requires_confirmation: true },
  { name: "create_clickup_list", description: "Create a ClickUp list in a folder (explicit user request only).", requires_confirmation: true },
  { name: "rename_clickup_list", description: "Rename a ClickUp list (explicit user request only).", requires_confirmation: true },
];

export function toolRequiresConfirmation(name: AgentToolName): boolean {
  return TOOL_REGISTRY.find((t) => t.name === name)?.requires_confirmation ?? true;
}

/**
 * Explicit tool categories used to decide when a "planned external action but no
 * confirmation was created" warning is legitimate.
 * - safe_read / safe_internal: never require a confirmation card.
 * - read_external_sync: read-only external syncs; may create a tool run but are not mutations.
 * - external_mutation: the ONLY category that must produce a pending confirmation.
 */
export type ToolCategory = "safe_read" | "safe_internal" | "read_external_sync" | "external_mutation";

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Safe / read-only
  read_clickup_hierarchy: "safe_read",
  get_project_context: "safe_read",
  answer_project_question: "safe_read",
  // Safe internal writes (no external side effects)
  update_project_memory: "safe_internal",
  create_proposed_tasks: "safe_internal",
  ask_clarification_questions: "safe_internal",
  // Read-only external syncs
  sync_clickup_hierarchy: "read_external_sync",
  sync_clickup_docs: "read_external_sync",
  sync_slack_channel: "read_external_sync",
  // External mutations (confirmation required)
  create_clickup_task: "external_mutation",
  create_clickup_doc: "external_mutation",
  link_clickup_doc_to_task: "external_mutation",
  update_clickup_task: "external_mutation",
  create_clickup_folder: "external_mutation",
  rename_clickup_folder: "external_mutation",
  move_clickup_doc: "external_mutation",
  move_clickup_task: "external_mutation",
  archive_clickup_folder: "external_mutation",
  create_clickup_list: "external_mutation",
  rename_clickup_list: "external_mutation",
};

export function getToolCategory(name: string): ToolCategory {
  // Unknown tools default to external_mutation so we never silently run something risky.
  return TOOL_CATEGORIES[name] ?? "external_mutation";
}

/** True only for tools that create/modify external resources and therefore need a confirmation card. */
export function isExternalMutationTool(name: string): boolean {
  return getToolCategory(name) === "external_mutation";
}

import {
  buildSuppressedQuestionKeys,
  mergeAppendStringArrays,
  mergeRefreshedStringArrays,
} from "../memoryMerge.ts";

function mergeOptionalText(existing: string | null | undefined, incoming: string | null): string | null {
  const next = incoming?.trim() ?? "";
  if (!next) return existing?.trim() || null;
  if (!existing?.trim()) return next;
  if (existing.trim().toLowerCase() === next.toLowerCase()) return existing.trim();
  return `${existing.trim()} ${next}`.slice(0, 4000);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function executeUpdateProjectMemory(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  memoryUpdates: Record<string, unknown>;
  sourceId?: string;
  suppressedQuestionKeys?: Set<string>;
}): Promise<void> {
  const { data: existing } = await args.admin
    .from("project_pm_profiles")
    .select("*")
    .eq("project_id", args.projectId)
    .maybeSingle();

  const mem = args.memoryUpdates;
  const suppressed = args.suppressedQuestionKeys;
  const row = {
    project_id: args.projectId,
    business_goal: mergeOptionalText(existing?.business_goal as string | null, mem.business_goal as string | null),
    target_users: mergeAppendStringArrays(asStringArray(existing?.target_users), asStringArray(mem.target_users)),
    core_flows: mergeAppendStringArrays(asStringArray(existing?.core_flows), asStringArray(mem.core_flows)),
    scope_in: mergeAppendStringArrays(asStringArray(existing?.scope_in), asStringArray(mem.scope_in)),
    scope_out: mergeAppendStringArrays(asStringArray(existing?.scope_out), asStringArray(mem.scope_out)),
    success_criteria: mergeAppendStringArrays(
      asStringArray(existing?.success_criteria),
      asStringArray(mem.success_criteria),
    ),
    risks: mergeRefreshedStringArrays(
      asStringArray(existing?.risks),
      mem.risks !== undefined ? asStringArray(mem.risks) : undefined,
      suppressed,
    ),
    open_questions: mergeRefreshedStringArrays(
      asStringArray(existing?.open_questions),
      mem.open_questions !== undefined ? asStringArray(mem.open_questions) : undefined,
      suppressed,
    ),
    delivery_notes: mergeAppendStringArrays(asStringArray(existing?.delivery_notes), asStringArray(mem.delivery_notes)),
    qa_strategy: mergeOptionalText(existing?.qa_strategy as string | null, mem.qa_strategy as string | null),
    last_source_id: args.sourceId ?? existing?.last_source_id ?? null,
    created_by: args.userId,
  };

  const { error } = await args.admin.from("project_pm_profiles").upsert(row, { onConflict: "project_id" });
  if (error) throw new Error(error.message);
}

export async function executeCreateProposedTasks(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  tasks: Array<Record<string, unknown>>;
  sourceId?: string;
}): Promise<string[]> {
  if (args.tasks.length === 0) return [];
  const { data: existingTasks } = await args.admin
    .from("ai_proposed_tasks")
    .select("title")
    .eq("project_id", args.projectId);

  const existingTitles = new Set(
    (existingTasks ?? []).map((r: { title: string }) => r.title.trim().toLowerCase()),
  );

  const rows = args.tasks
    .filter((t) => typeof t.title === "string" && !existingTitles.has(String(t.title).trim().toLowerCase()))
    .map((t) => {
      const estimateMinutes = typeof t.time_estimate_minutes === "number" && t.time_estimate_minutes > 0
        ? t.time_estimate_minutes
        : null;
      const dueDate = typeof t.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date.trim())
        ? t.due_date.trim()
        : null;
      return {
        project_id: args.projectId,
        source_knowledge_source_id: args.sourceId ?? null,
        title: String(t.title),
        description: typeof t.description === "string" ? t.description : null,
        acceptance_criteria: asStringArray(t.acceptance_criteria),
        qa_scenarios: Array.isArray(t.qa_scenarios) ? t.qa_scenarios : [],
        implementation_notes: asStringArray(t.implementation_notes),
        priority: ["low", "medium", "high", "urgent"].includes(String(t.priority)) ? String(t.priority) : "medium",
        estimate_hours: estimateMinutes !== null ? Math.round((estimateMinutes / 60) * 100) / 100 : null,
        selected_due_date: dueDate,
        selected_clickup_assignee_ids: asStringArray(t.clickup_assignee_ids),
        confidence: typeof t.confidence === "number" ? t.confidence : 0.7,
        status: "pending",
        raw_item: t,
        created_by: args.userId,
      };
    });

  if (rows.length === 0) return [];
  const { data, error } = await args.admin.from("ai_proposed_tasks").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id);
}

export async function executeClarificationQuestions(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  questions: AgentPlan["clarification_questions"];
  agentRunId: string;
  sourceId?: string;
}): Promise<string[]> {
  const qs = (args.questions ?? []).slice(0, 3);
  if (qs.length === 0) return [];

  const rows = qs.map((q) => ({
    project_id: args.projectId,
    question: q.question,
    reason: q.reason ?? null,
    importance: q.importance ?? "medium",
    blocks_task_creation: q.blocks_task_creation ?? false,
    status: "open",
    source_knowledge_source_id: args.sourceId ?? null,
    question_key: q.question.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200),
    created_by: args.userId,
    metadata: { agent_run_id: args.agentRunId },
  }));

  const { data, error } = await args.admin.from("project_pm_attention_items").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id);
}

export async function prepareCreateClickupDocToolRunInput(args: {
  rawInput: Record<string, unknown>;
  projectId: string;
  agentRunId: string;
  requestText: string;
  contextBlock: string;
  hierarchyRows?: ClickupHierarchyRow[];
  clickupLink?: Record<string, unknown> | null;
  trace?: TraceMetadata;
}): Promise<{ input: Record<string, unknown>; meta: ClickupDocLangSmithMeta; normalizationApplied: boolean }> {
  const sourceContext = {
    agent_run_id: args.agentRunId,
    project_id: args.projectId,
    request_text: args.requestText,
  };

  let { payload, normalizationApplied } = normalizeCreateClickupDocPayload(args.rawInput, sourceContext);

  if (!payload.destination && args.hierarchyRows && args.hierarchyRows.length > 0) {
    const suggested = suggestDocDestination({
      rows: args.hierarchyRows,
      link: args.clickupLink,
      requestText: args.requestText,
      docTitle: payload.title,
    });
    payload.destination = suggested;
    payload.parent = { type: suggested.type, id: suggested.id };
    normalizationApplied = true;
  }

  const similar = args.hierarchyRows ? findSimilarDoc(args.hierarchyRows, payload.title) : undefined;
  if (similar) {
    throw new Error(
      `A similar ClickUp doc already exists: "${similar.name}". Ask to update the existing doc instead of creating a duplicate.`,
    );
  }

  if (payload.content_markdown.length < CLICKUP_DOC_MIN_CONTENT_LENGTH) {
    const generated = await generateClickupDocMarkdown({
      title: payload.title.trim() || "Project document",
      requestText: args.requestText,
      contextBlock: args.contextBlock,
      trace: args.trace,
    });
    if (generated.content_markdown.length >= CLICKUP_DOC_MIN_CONTENT_LENGTH) {
      payload.content_markdown = generated.content_markdown;
      normalizationApplied = true;
    }
  }

  if (!payload.title.trim() && payload.content_markdown) {
    const heading = payload.content_markdown.match(/^#\s+(.+)$/m);
    if (heading?.[1]) payload.title = heading[1].trim();
  }

  validateCreateClickupDocPayload(payload);

  logClickupDocToolPayload({
    phase: "prepare",
    titleLength: payload.title.length,
    contentLength: payload.content_markdown.length,
    normalizationApplied,
    agentRunId: args.agentRunId,
  });

  return {
    input: createClickupDocPayloadForStorage(payload),
    meta: clickupDocLangSmithMeta(payload, normalizationApplied),
    normalizationApplied,
  };
}

export function prepareCreateClickupTaskToolRunInput(args: {
  rawInput: Record<string, unknown>;
  requestText: string;
  hierarchyRows?: ClickupHierarchyRow[];
  clickupLink?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const input = { ...args.rawInput };
  if (!input.destination && args.hierarchyRows && args.hierarchyRows.length > 0) {
    const suggested = suggestTaskDestination({
      rows: args.hierarchyRows,
      link: args.clickupLink,
      requestText: args.requestText,
      taskTitle: String(input.title ?? ""),
    });
    input.destination = suggested;
    input.list_id = suggested.id;
  }
  return input;
}

export function prepareLinkClickupDocToTaskInput(args: {
  rawInput: Record<string, unknown>;
  stepKey: string;
}): Record<string, unknown> {
  return {
    ...args.rawInput,
    project_id: args.rawInput.project_id,
    doc_ref: args.rawInput.doc_ref ?? args.rawInput.doc_id,
    task_ref: args.rawInput.task_ref ?? args.rawInput.task_id,
    doc_url: args.rawInput.doc_url,
    task_url: args.rawInput.task_url,
    link_mode: args.rawInput.link_mode ?? "task_description",
    explanation:
      args.rawInput.explanation ??
      "After the doc and task are created, the doc link will be added to the task so implementers can find the guide.",
  };
}
export async function createPendingToolRun(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  agentRunId: string;
  toolName: AgentToolName;
  input: Record<string, unknown>;
  workflow?: {
    workflow_id: string;
    workflow_name: string;
    step_key: string;
    step_order: number;
    depends_on?: string[];
  };
}): Promise<string> {
  const requiresConfirmation = toolRequiresConfirmation(args.toolName);
  const row: Record<string, unknown> = {
    project_id: args.projectId,
    user_id: args.userId,
    agent_run_id: args.agentRunId,
    tool_name: args.toolName,
    status: requiresConfirmation ? "needs_confirmation" : "pending",
    requires_confirmation: requiresConfirmation,
    input_payload: args.input,
  };
  if (args.workflow) {
    row.workflow_id = args.workflow.workflow_id;
    row.workflow_name = args.workflow.workflow_name;
    row.step_key = args.workflow.step_key;
    row.step_order = args.workflow.step_order;
    row.depends_on = args.workflow.depends_on ?? [];
  }
  const { data, error } = await args.admin
    .from("agent_tool_runs")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
