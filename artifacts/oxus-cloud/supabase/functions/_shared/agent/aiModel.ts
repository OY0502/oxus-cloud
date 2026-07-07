import {
  buildLangfuseTraceUrl,
  createLangfuseGeneration,
  createLangfuseTrace,
  isLangfuseEnabled,
  patchLangfuseGeneration,
  patchLangfuseTrace,
} from "./langfuse.ts";
import type { AgentPlan, AgentMode, AgentToolName, AgentWorkflowPlan, AgentWorkflowStep, RetrievalChunk, TraceMetadata } from "./types.ts";
import { extractToolCallInput } from "./clickupDocTool.ts";
import type { ClickupHierarchyRow } from "../clickupHierarchy.ts";
import { buildHierarchyContextBlock } from "../clickupHierarchy.ts";

export function openRouterConfig() {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const baseUrl = (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const model = Deno.env.get("OPENROUTER_DEFAULT_MODEL")?.trim() || "openai/gpt-5.1";
  const appName = Deno.env.get("OPENROUTER_APP_NAME")?.trim() || "OXUS Cloud";
  const siteUrl = Deno.env.get("OPENROUTER_SITE_URL")?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");
  return { apiKey, baseUrl, model, appName, siteUrl };
}

async function callOpenRouterJson(args: {
  messages: { role: "system" | "user"; content: string }[];
  trace?: TraceMetadata;
  traceName?: string;
}): Promise<{ content: string; model: string; traceId: string | null; generationId: string | null }> {
  const cfg = openRouterConfig();
  const traceHandle = await createLangfuseTrace({
    name: args.traceName ?? "openrouter-json",
    metadata: { ...args.trace, model: cfg.model, prompt_type: args.traceName },
    input: { message_count: args.messages.length },
  });
  const generationId = traceHandle
    ? await createLangfuseGeneration({
      traceId: traceHandle.traceId,
      name: args.traceName ?? "openrouter-json",
      model: cfg.model,
      metadata: args.trace,
      input: { message_count: args.messages.length },
    })
    : null;

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.siteUrl ? { "HTTP-Referer": cfg.siteUrl } : {}),
      "X-Title": cfg.appName,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: args.messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    if (generationId) await patchLangfuseGeneration(generationId, { error: text.slice(0, 500) });
    if (traceHandle) await patchLangfuseTrace(traceHandle.traceId, { error: text.slice(0, 500) });
    throw new Error(`OpenRouter error (${response.status}): ${text.slice(0, 800)}`);
  }

  const completion = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    if (generationId) await patchLangfuseGeneration(generationId, { error: "empty content" });
    throw new Error("OpenRouter returned empty content.");
  }

  if (generationId) {
    await patchLangfuseGeneration(generationId, {
      output: { chars: content.length },
      metadata: args.trace,
    });
  }
  if (traceHandle) {
    await patchLangfuseTrace(traceHandle.traceId, {
      output: { chars: content.length },
      metadata: args.trace,
    });
  }

  return {
    content,
    model: cfg.model,
    traceId: traceHandle?.traceId ?? null,
    generationId,
  };
}

export async function generateStructuredObject<T>(args: {
  schemaDescription: string;
  userPrompt: string;
  systemPrompt?: string;
  trace?: TraceMetadata;
  traceName?: string;
}): Promise<{ data: T; model: string; traceId: string | null; generationId: string | null }> {
  const { content, model, traceId, generationId } = await callOpenRouterJson({
    trace: args.trace,
    traceName: args.traceName ?? "generateStructuredObject",
    messages: [
      {
        role: "system",
        content: args.systemPrompt ?? "You are a precise assistant. Output valid JSON only.",
      },
      {
        role: "user",
        content: `${args.schemaDescription}\n\n${args.userPrompt}`,
      },
    ],
  });
  return { data: JSON.parse(content) as T, model, traceId, generationId };
}

/**
 * Shared product/client identity guidance so every prompt describes OXUS and the
 * client/project consistently. `OXUS` (all caps) is the agency/operator running the
 * work; `OXUS Cloud` is this project-intelligence + agency-operations platform. The
 * work is delivered FOR the client/project (e.g. Carrotz), not for OXUS — unless the
 * project's own client/name is OXUS.
 */
export function oxusIdentityGuidance(project?: {
  projectName?: string | null;
  clientName?: string | null;
  projectType?: string | null;
}): string {
  const client = project?.clientName?.trim();
  const name = project?.projectName?.trim();
  const clientRef = client || name;
  const lines = [
    "Identity rules:",
    "- The agency/operator is OXUS (always all caps, never 'Oxus').",
    "- OXUS Cloud is the project-intelligence and agency-operations platform you run inside.",
    "- OXUS is NOT the client. Work is delivered FOR the client/project below.",
  ];
  if (name) lines.push(`- Current project name: ${name}.`);
  if (client) lines.push(`- Current client: ${client}.`);
  if (clientRef) {
    lines.push(
      `- Phrase generated tasks, docs, memory, and status updates as helping ${clientRef} (the client/project), NOT "helping OXUS", unless the client/project itself is OXUS.`,
    );
  } else {
    lines.push(
      "- No explicit client name is set; refer to \"the project\" or \"the client team\" rather than saying the work is for OXUS.",
    );
  }
  lines.push(
    "- Only describe work as internal to OXUS when the task is genuinely an internal OXUS operations task.",
  );
  lines.push(
    "- Company website enrichment is BACKGROUND context about who the client is — it is not the project scope unless it aligns with an explicit request.",
  );
  lines.push(
    "- When present, the proposal/client request message is the PRIMARY source for the initial project scope and tasks.",
  );
  return lines.join("\n");
}

function buildProjectIdentityBlock(ctx: {
  projectName?: string | null;
  clientName?: string | null;
  projectType?: string | null;
}): string {
  const facts: string[] = [];
  if (ctx.projectName) facts.push(`name: ${ctx.projectName}`);
  if (ctx.clientName) facts.push(`client: ${ctx.clientName}`);
  if (ctx.projectType) facts.push(`type: ${ctx.projectType}`);
  const header = facts.length > 0 ? `Project identity — ${facts.join(", ")}.` : "Project identity — client/name not set.";
  return `${header}\n${oxusIdentityGuidance(ctx)}`;
}

export function buildAgentContextBlock(ctx: {
  projectName?: string | null;
  clientName?: string | null;
  projectType?: string | null;
  profile?: Record<string, unknown> | null;
  chunks: RetrievalChunk[];
  openAttention?: unknown[];
  proposedTasks?: unknown[];
  pmActions?: unknown[];
  timeline?: unknown[];
  signals?: unknown[];
  clickupConnected?: boolean;
  slackConnected?: boolean;
  clickupHierarchy?: ClickupHierarchyRow[];
  clickupLink?: Record<string, unknown> | null;
}): string {
  const parts: string[] = [];
  parts.push(buildProjectIdentityBlock(ctx));
  if (ctx.profile) parts.push(`Project memory:\n${JSON.stringify(ctx.profile, null, 2)}`);
  if (ctx.chunks.length > 0) {
    parts.push(
      `Retrieved knowledge chunks:\n${
        ctx.chunks.map((c, i) => `[${i + 1}] (sim=${c.similarity?.toFixed(3) ?? "n/a"})\n${c.content.slice(0, 2000)}`).join("\n\n")
      }`,
    );
  }
  if (ctx.clickupConnected && ctx.clickupHierarchy && ctx.clickupHierarchy.length > 0) {
    parts.push(buildHierarchyContextBlock(ctx.clickupHierarchy, ctx.clickupLink));
  }
  if (ctx.openAttention?.length) parts.push(`Open clarification items:\n${JSON.stringify(ctx.openAttention, null, 2)}`);
  if (ctx.proposedTasks?.length) parts.push(`Existing proposed tasks:\n${JSON.stringify(ctx.proposedTasks, null, 2)}`);
  if (ctx.pmActions?.length) parts.push(`Active PM actions:\n${JSON.stringify(ctx.pmActions, null, 2)}`);
  if (ctx.timeline?.length) parts.push(`Recent timeline:\n${JSON.stringify(ctx.timeline, null, 2)}`);
  if (ctx.signals?.length) parts.push(`Recent signals:\n${JSON.stringify(ctx.signals, null, 2)}`);
  parts.push(`Integrations: clickup=${ctx.clickupConnected ? "connected" : "not_connected"}, slack=${ctx.slackConnected ? "connected" : "not_connected"}`);
  return parts.join("\n\n");
}

const AGENT_PLAN_SCHEMA = `Return strict JSON:
{
  "detected_intent": "answer | memory_update | create_clickup_task | create_clickup_doc | sync_request | folder_management | mixed",
  "answer": "string | null",
  "memory_updates": { "business_goal": "string|null", "target_users": ["string"], "core_flows": ["string"], "success_criteria": ["string"], "scope_in": ["string"], "scope_out": ["string"], "risks": ["string"], "open_questions": ["string"], "delivery_notes": ["string"], "qa_strategy": "string|null" },
  "proposed_tasks": [{ "title": "string (clean, specific, action-oriented)", "description": "string (detailed: objective, implementation notes, and context — never vague)", "assignee_names": ["string"], "clickup_assignee_ids": ["string"], "priority": "low|medium|high|urgent", "status": "string|null (suggested ClickUp status, e.g. 'to do', 'in progress')", "due_date": "string|null (YYYY-MM-DD)", "time_estimate_minutes": "number|null (only when there is enough context)", "acceptance_criteria": ["string"], "source_context": {}, "source_reason": "string" }],
  "clarification_questions": [{ "question": "string", "reason": "string", "importance": "low|medium|high", "blocks_task_creation": false }],
  "tool_calls": [{
    "tool_name": "create_clickup_task|create_clickup_doc|link_clickup_doc_to_task|sync_clickup_docs|sync_slack_channel|read_clickup_hierarchy|sync_clickup_hierarchy|create_clickup_folder|rename_clickup_folder|move_clickup_doc|move_clickup_task|archive_clickup_folder|create_clickup_list|rename_clickup_list",
    "requires_confirmation": true,
    "input": {
      "title": "string (required for create_clickup_task and create_clickup_doc)",
      "description": "string (create_clickup_task)",
      "content_markdown": "string (REQUIRED for create_clickup_doc — full markdown document, min 100 chars)",
      "destination": { "type": "folder|list|space", "id": "string", "name": "string", "path": "string", "reason": "string" },
      "assignee_hint": "string",
      "due_date_hint": "string",
      "priority": "low|medium|high|urgent",
      "doc_ref": "string or {{step_key.external_id}} (link_clickup_doc_to_task)",
      "task_ref": "string or {{step_key.external_id}} (link_clickup_doc_to_task)",
      "doc_url": "string or {{step_key.url}} (link_clickup_doc_to_task)",
      "link_mode": "task_description|task_comment|clickup_attachment|internal_link",
      "name": "string (folder/list management)",
      "folder_id": "string",
      "list_id": "string",
      "parent_folder_name": "string"
    }
  }],
  "workflows": [{
    "workflow_name": "string",
    "steps": [{
      "tool_name": "create_clickup_doc|create_clickup_task|link_clickup_doc_to_task",
      "step_key": "string (unique within workflow, e.g. lokalise_doc)",
      "requires_confirmation": true,
      "depends_on": ["step_key"],
      "input": { "...tool-specific fields..." }
    }]
  }],
  "summary": "string",
  "confidence": 0.0
}
Rules:
- Max 3 clarification_questions. Prefer 0.
- Side-effect tools (ClickUp create/update/move) must set requires_confirmation=true.
- Read existing ClickUp hierarchy before proposing docs/tasks. Prefer existing folders/lists.
- NEVER create, rename, move, or archive folders/lists unless the user explicitly asks for folder/list management.
- For normal doc/task creation, pick the best existing destination from hierarchy and include destination in tool input.
- Do not duplicate existing docs — if a similar doc exists, suggest updating it instead of creating a new one.
- Folder management tools (create_clickup_folder, rename_clickup_folder, etc.) ONLY when user explicitly requests reorganization.
- For Q&A, populate answer and summary; skip memory_updates unless user asked to remember something.
- ONLY plan create_clickup_task / create_clickup_doc / other external ClickUp tools when the user EXPLICITLY asks to create a ClickUp task or doc. Parsing a transcript or updating memory is NOT a request to create ClickUp items.
- read_clickup_hierarchy is unnecessary to plan: the current ClickUp hierarchy is already provided in context. Do not emit it as a tool_call.
- proposed_tasks are internal PM-review items (ai_proposed_tasks), NOT ClickUp tasks. They are project delivery tasks for the CLIENT/project described in context (e.g. the client's product), not "internal tasks for OXUS" unless the work is genuinely internal OXUS agency/admin work.
- In summary, describe them as "proposed project tasks for PM review" (e.g. "Proposed 3 project tasks for PM review: ..."). Never imply they are already created in ClickUp.
- Do not create tasks that merely restate the input (e.g. "summarize the recording") unless genuinely useful. Keep the number of proposed tasks small and high-value.
- For ClickUp task requests, include create_clickup_task with title, description, destination list recommendation.
- Proposed tasks must be rich and specific: never vague descriptions. Include objective, implementation notes, acceptance_criteria, and source_context when useful.
- For implementation tasks, propose a realistic status and priority. Suggest time_estimate_minutes ONLY when there is enough context; otherwise leave it null.
- The PM can override every field before the task is created, so provide sensible defaults rather than asking.
- For ClickUp doc requests (create_clickup_doc):
  * ALWAYS populate input.title AND input.content_markdown with FULL markdown (min 100 chars).
  * Include destination object with path and reason.
  * Never empty or placeholder content.
- For compound requests (create doc + create task + attach/link doc to task):
  * Use workflows[] with ordered steps: create_clickup_doc, create_clickup_task, link_clickup_doc_to_task.
  * Generate full markdown for the doc step and complete task title/description before confirmation.
  * Use step_key refs in link step: doc_ref={{doc_step.external_id}}, task_ref={{task_step.external_id}}, doc_url={{doc_step.url}}.
  * Do NOT use separate tool_calls for steps already in a workflow.
  * Set link_mode to task_description unless user explicitly needs a comment.
- Never say external actions were completed — only propose tool_calls or workflows with pending confirmations.
- Never claim "prepared tool calls" unless workflows or tool_calls are populated.`;

export async function generateAgentPlan(args: {
  inputText: string;
  mode: AgentMode;
  context: Parameters<typeof buildAgentContextBlock>[0];
  trace?: TraceMetadata;
}): Promise<{ plan: AgentPlan; model: string; traceId: string | null; generationId: string | null }> {
  const modeHint = args.mode === "auto"
    ? "Detect intent automatically."
    : `Forced mode: ${args.mode}.`;

  const { data, model, traceId, generationId } = await generateStructuredObject<AgentPlan>({
    trace: { ...args.trace, prompt_type: "generateAgentPlan", chunks_retrieved_count: args.context.chunks.length },
    traceName: "generateAgentPlan",
    schemaDescription: AGENT_PLAN_SCHEMA,
    systemPrompt: [
      "You are the OXUS Cloud project agent.",
      "This is a single-shot intake, NOT a chat.",
      "Plan safe actions; external side effects require confirmation.",
      "You have access to the existing ClickUp hierarchy in context.",
      "Prefer existing folders/lists for doc and task placement.",
      "Never reorganize ClickUp structure unless the user explicitly asks.",
      oxusIdentityGuidance({
        projectName: args.context.projectName,
        clientName: args.context.clientName,
        projectType: args.context.projectType,
      }),
      modeHint,
    ].join(" "),
    userPrompt: `User input:\n${args.inputText}\n\n${buildAgentContextBlock(args.context)}`,
  });

  const plan: AgentPlan = {
    detected_intent: data.detected_intent ?? "mixed",
    answer: data.answer ?? null,
    memory_updates: data.memory_updates ?? {},
    proposed_tasks: data.proposed_tasks ?? [],
    clarification_questions: (data.clarification_questions ?? []).slice(0, 3),
    tool_calls: (data.tool_calls ?? []).map((tc) => {
      const raw = tc as Record<string, unknown> & { tool_name?: AgentToolName; requires_confirmation?: boolean };
      return {
        tool_name: raw.tool_name as AgentToolName,
        input: extractToolCallInput(raw),
        requires_confirmation: raw.requires_confirmation !== false,
      };
    }),
    workflows: (data.workflows ?? []).map((wf) => {
      const raw = wf as AgentWorkflowPlan;
      return {
        workflow_name: String(raw.workflow_name ?? "Agent workflow"),
        steps: (raw.steps ?? []).map((step) => {
          const s = step as AgentWorkflowStep & Record<string, unknown>;
          return {
            tool_name: s.tool_name,
            step_key: String(s.step_key ?? s.tool_name),
            requires_confirmation: s.requires_confirmation !== false,
            depends_on: Array.isArray(s.depends_on) ? s.depends_on.filter((d): d is string => typeof d === "string") : [],
            input: extractToolCallInput(s),
          };
        }),
      };
    }),
    summary: data.summary ?? "",
    confidence: data.confidence,
  };

  return { plan, model, traceId, generationId };
}

export async function generateMemoryUpdate(args: {
  inputText: string;
  existingProfile?: Record<string, unknown> | null;
  trace?: TraceMetadata;
  suppressedQuestionKeys?: Set<string>;
  projectName?: string | null;
  clientName?: string | null;
  projectType?: string | null;
}) {
  const suppressedBlock = args.suppressedQuestionKeys && args.suppressedQuestionKeys.size > 0
    ? `\n\nDo NOT repeat these previously skipped, cleared, or answered questions unless materially new context requires them.`
    : "";

  return generateStructuredObject<{ memory_updates: Record<string, unknown>; summary: string }>({
    trace: args.trace,
    traceName: "generateMemoryUpdate",
    schemaDescription: '{"memory_updates":{"risks":["string"],"open_questions":["string"]},"summary":"string"}',
    systemPrompt: [
      "Merge intake into project memory.",
      "For risks and open_questions: return COMPLETE refreshed lists (existing memory + new source).",
      "Remove answered/resolved items. Dedupe similar wording.",
      "For other memory_updates fields: only include new or updated items.",
      oxusIdentityGuidance({
        projectName: args.projectName,
        clientName: args.clientName,
        projectType: args.projectType,
      }),
      "Output valid JSON only.",
    ].join(" "),
    userPrompt: `Merge this intake into project memory:\n${args.inputText}\n\nExisting:\n${
      JSON.stringify(args.existingProfile ?? {}, null, 2)
    }${suppressedBlock}`,
  });
}

export async function generateTaskDraft(args: {
  instruction: string;
  context: string;
  trace?: TraceMetadata;
}) {
  return generateStructuredObject<{
    title: string;
    description: string;
    priority: string;
    assignee_hint?: string;
    due_date_hint?: string;
  }>({
    trace: args.trace,
    traceName: "generateTaskDraft",
    schemaDescription: '{"title":"","description":"","priority":"medium","assignee_hint":"","due_date_hint":""}',
    userPrompt: `${args.instruction}\n\nContext:\n${args.context}`,
  });
}

export async function generateClickupDocMarkdown(args: {
  title: string;
  requestText: string;
  contextBlock: string;
  trace?: TraceMetadata;
}): Promise<{ content_markdown: string; model: string; traceId: string | null; generationId: string | null }> {
  const docTitle = args.title.trim() || "Project document";
  const { data, model, traceId, generationId } = await generateStructuredObject<{ content_markdown: string }>({
    trace: args.trace,
    traceName: "generateClickupDocMarkdown",
    schemaDescription: '{"content_markdown":"string"}',
    systemPrompt: [
      "You write complete ClickUp documents in markdown.",
      "Output valid JSON only with a single content_markdown field.",
      "Never use placeholder text. Minimum 400 characters of substantive content.",
      "Use the exact company casing OXUS (never 'Oxus'). Frame the document as work for the client/project described in the project context, not for OXUS, unless the client/project is OXUS.",
    ].join(" "),
    userPrompt: [
      `Write the full markdown body for a ClickUp doc titled: ${docTitle}`,
      `User request: ${args.requestText}`,
      "",
      "Requirements:",
      "- Start with # heading matching the document title",
      "- Include: purpose, assumptions and limitations",
      "- For competitor/market topics: competitor categories, likely competitor types, comparison dimensions, project implications, recommended next research steps",
      "- Use ## sections and bullet lists",
      "- Label unverified market facts as high-level draft from available context — not verified research",
      "- Use project context below when relevant",
      "",
      "Project context:",
      args.contextBlock,
    ].join("\n"),
  });

  return {
    content_markdown: String(data.content_markdown ?? "").trim(),
    model,
    traceId,
    generationId,
  };
}

export { isLangfuseEnabled, buildLangfuseTraceUrl };
