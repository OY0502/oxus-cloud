import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isConfirmableAgentToolRun } from "./toolRunUtils.ts";
import { mergeAndValidateClickupDocPayload } from "./clickupDocTool.ts";
import { buildLangfuseTraceUrl, generateAgentPlan, buildAgentContextBlock, isLangfuseEnabled } from "./aiModel.ts";
import { createLangfuseTrace, patchLangfuseTrace, type TraceMetadata } from "./langfuse.ts";
import { reconcileProjectAttentionItems, type AttentionReconciliationResult } from "./attentionReconciliation.ts";
import { retrieveProjectKnowledge } from "./retrieval.ts";
import { buildSuppressedQuestionKeys } from "../memoryMerge.ts";
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
import type { AgentWorkflowPlan, AgentWorkflowStep } from "./types.ts";
import type { ClickupDocLangSmithMeta } from "./clickupDocTool.ts";
import type {
  AgentDiagnostics,
  AgentMode,
  AgentPlan,
  AgentRunStatus,
  ProjectAgentRunInput,
} from "./types.ts";
import { isTriggerDevConfigured } from "./triggerDev.ts";

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
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

  const chunks = chunkText(args.inputText, Number(Deno.env.get("AI_CHUNK_SIZE_CHARS") ?? "10000"));
  if (chunks.length > 0) {
    await args.admin.from("project_knowledge_chunks").insert(
      chunks.map((content, index) => ({
        project_id: args.projectId,
        source_id: data.id,
        chunk_index: index,
        content,
        category: "agent_intake",
        metadata: { char_count: content.length },
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

  const chunks = chunkText(args.sourceText, Number(Deno.env.get("AI_CHUNK_SIZE_CHARS") ?? "10000"));
  if (chunks.length > 0) {
    await args.admin.from("project_knowledge_chunks").insert(
      chunks.map((content, index) => ({
        project_id: args.projectId,
        source_id: data.id,
        chunk_index: index,
        content,
        category: "uploaded_file",
        metadata: { file_name: args.fileName, char_count: content.length },
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
}): Promise<{ combinedText: string; sourceIds: string[] }> {
  if (!args.fileIds.length) return { combinedText: "", sourceIds: [] };

  const { data: attachments, error } = await args.admin
    .from("attachments")
    .select("id, file_name, file_path, mime_type")
    .in("id", args.fileIds)
    .eq("entity_type", "project")
    .eq("entity_id", args.projectId);
  if (error) throw new Error(error.message);

  const parts: string[] = [];
  const sourceIds: string[] = [];

  for (const att of attachments ?? []) {
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
    if (sourceId) sourceIds.push(sourceId);
  }

  return { combinedText: parts.join("\n\n"), sourceIds };
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
  ] = await Promise.all([
    args.admin.from("projects").select("name, client_name, description, project_type").eq("id", input.project_id).maybeSingle(),
    args.admin.from("project_pm_profiles").select("*").eq("project_id", input.project_id).maybeSingle(),
    args.admin.from("project_pm_attention_items").select("*").eq("project_id", input.project_id).eq("status", "open").limit(10),
    args.admin.from("ai_proposed_tasks").select("id, title, status, priority").eq("project_id", input.project_id).eq("status", "pending").limit(20),
    args.admin.from("project_pm_action_items").select("id, title, status, priority, source_type").eq("project_id", input.project_id).in("status", ["open", "in_progress"]).limit(20),
    args.admin.from("project_timeline_events").select("event_title, event_summary, source_type, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(15),
    args.admin.from("project_signals").select("title, summary, signal_type, signal_status").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(15),
    args.admin.from("project_clickup_links").select("*").eq("project_id", input.project_id).maybeSingle(),
    args.admin.from("project_slack_links").select("id").eq("project_id", input.project_id).maybeSingle(),
  ]);

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

  const retrieval = agentInputText
    ? await retrieveProjectKnowledge({ admin: args.admin, projectId: input.project_id, queryText: agentInputText })
    : { chunks: [], mode: "fallback" as const, clickup_doc_chunks_retrieved: 0 };

  const projectRow = projectRes.data as
    | { name?: string | null; client_name?: string | null; description?: string | null; project_type?: string | null }
    | null;

  const agentContext = {
    projectName: projectRow?.name ?? null,
    clientName: projectRow?.client_name ?? null,
    projectType: projectRow?.project_type ?? null,
    profile: profileRes.data,
    chunks: retrieval.chunks,
    openAttention: attentionRes.data ?? [],
    proposedTasks: tasksRes.data ?? [],
    pmActions: pmActionsRes.data ?? [],
    timeline: timelineRes.data ?? [],
    signals: signalsRes.data ?? [],
    clickupConnected,
    slackConnected: !!slackLinkRes.data,
    clickupHierarchy: hierarchyRows,
    clickupLink: clickupLinkRes.data as Record<string, unknown> | null,
  };

  const { plan, model, traceId, generationId } = await generateAgentPlan({
    inputText: agentInputText || "Review project context and summarize current state.",
    mode,
    trace: {
      project_id: input.project_id,
      agent_run_id: input.agent_run_id,
      source: "project-agent-run",
      runtime: args.runtime ?? "edge-sync-fallback",
      chunks_retrieved_count: retrieval.chunks.length,
      clickup_doc_chunks_retrieved: retrieval.clickup_doc_chunks_retrieved,
    },
    context: agentContext,
  });

  const toolRunIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdSourceIds: string[] = [...fileIntake.sourceIds];

  let sourceId: string | undefined;
  if (inputText && (mode !== "answer_only" || Object.keys(plan.memory_updates ?? {}).length > 0)) {
    sourceId = await storeIntakeSource({
      admin: args.admin,
      projectId: input.project_id,
      userId: input.user_id,
      inputText,
      plan,
    });
    if (sourceId) createdSourceIds.push(sourceId);
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
  if (mode !== "answer_only" && agentInputText.trim()) {
    try {
      reconciliation = await reconcileProjectAttentionItems({
        admin: args.admin,
        projectId: input.project_id,
        userId: input.user_id,
        newContextText: [plan.summary, agentInputText].filter(Boolean).join("\n\n"),
        updatedMemory: hasMemoryUpdates ? plan.memory_updates : (profileRes.data as Record<string, unknown> | null),
        sourceIds: createdSourceIds,
        sourceType: "agent_intake",
        sourceTitle: "Project agent intake",
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
      sourceId,
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
  const plannedToolNames: string[] = [
    ...(plan.tool_calls ?? []).map((t) => t.tool_name),
    ...(plan.workflows ?? []).flatMap((w) => (w.steps ?? []).map((s) => s.tool_name)),
  ].filter((n): n is string => !!n);
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
      ...(retrieval.embeddings_enabled === false
        ? [`Embeddings disabled (${retrieval.embedding_skip_reason ?? "not configured"}), using fallback retrieval.`]
        : []),
    ].filter(Boolean).length > 0
      ? [
          ...hierarchyWarnings,
          ...skippedDocToolErrors,
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

  await args.admin
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
  if (!isConfirmableAgentToolRun(toolRun)) {
    throw new Error(`Tool run is not confirmable (status=${toolRun.status}).`);
  }

  let payload = {
    ...(toolRun.input_payload as Record<string, unknown>),
    ...(args.inputOverrides ?? {}),
  };

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
