import {
  buildLangfuseTraceUrl,
  createLangfuseGeneration,
  createLangfuseTrace,
  isLangfuseEnabled,
  patchLangfuseGeneration,
  patchLangfuseTrace,
} from "./langfuse.ts";
import type {
  AgentPlan,
  AgentMode,
  AgentToolName,
  AgentWorkflowPlan,
  AgentWorkflowStep,
  ProjectMeetingMemory,
  RetrievalChunk,
  TraceMetadata,
} from "./types.ts";
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

export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
};

async function callOpenRouterJson(args: {
  messages: { role: "system" | "user"; content: string }[];
  trace?: TraceMetadata;
  traceName?: string;
  model?: string;
  maxTokens?: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}): Promise<{ content: string; model: string; usage: OpenRouterUsage; traceId: string | null; generationId: string | null }> {
  const cfg = openRouterConfig();
  const model = args.model?.trim() || cfg.model;
  const traceHandle = await createLangfuseTrace({
    name: args.traceName ?? "openrouter-json",
    metadata: { ...args.trace, model, prompt_type: args.traceName },
    input: { message_count: args.messages.length },
  });
  const generationId = traceHandle
    ? await createLangfuseGeneration({
      traceId: traceHandle.traceId,
      name: args.traceName ?? "openrouter-json",
      model,
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
      model,
      messages: args.messages,
      response_format: args.jsonSchema
        ? {
          type: "json_schema",
          json_schema: {
            name: args.jsonSchema.name,
            strict: true,
            schema: args.jsonSchema.schema,
          },
        }
        : { type: "json_object" },
      ...(!args.jsonSchema ? { temperature: 0.2 } : {}),
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
      ...(args.reasoningEffort ? { reasoning: { effort: args.reasoningEffort, exclude: true } } : {}),
      ...(args.trace?.project_id ? { session_id: `oxus-project-${args.trace.project_id}` } : {}),
      provider: { data_collection: "deny", ...(args.jsonSchema ? { require_parameters: true } : {}) },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    if (generationId) await patchLangfuseGeneration(generationId, { error: text.slice(0, 500) });
    if (traceHandle) await patchLangfuseTrace(traceHandle.traceId, { error: text.slice(0, 500) });
    throw new Error(`OpenRouter error (${response.status}): ${text.slice(0, 800)}`);
  }

  const completion = JSON.parse(text) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: OpenRouterUsage;
  };
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    if (generationId) await patchLangfuseGeneration(generationId, { error: "empty content" });
    throw new Error("OpenRouter returned empty content.");
  }

  if (generationId) {
    await patchLangfuseGeneration(generationId, {
      output: { chars: content.length, usage: completion.usage ?? {} },
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
    model: completion.model ?? model,
    usage: completion.usage ?? {},
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
  model?: string;
  maxTokens?: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}): Promise<{ data: T; model: string; usage: OpenRouterUsage; traceId: string | null; generationId: string | null }> {
  const { content, model, usage, traceId, generationId } = await callOpenRouterJson({
    trace: args.trace,
    traceName: args.traceName ?? "generateStructuredObject",
    model: args.model,
    maxTokens: args.maxTokens,
    jsonSchema: args.jsonSchema,
    reasoningEffort: args.reasoningEffort,
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
  return { data: JSON.parse(content) as T, model, usage, traceId, generationId };
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
  operatingCadence?: Record<string, unknown> | null;
  meetingMemories?: Array<Record<string, unknown>>;
  projectFacts?: Array<Record<string, unknown>>;
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
  clickupTasks?: Array<{
    id: string;
    name: string;
    description?: string | null;
    status?: string | null;
    url?: string | null;
    list_name?: string | null;
    assignees?: string[];
    due_date?: string | null;
    updated_at?: string | null;
  }>;
  clickupTaskSnapshotSource?: "live" | "cached" | "unavailable";
  slackMessages?: unknown[];
  slackContextSource?: "live" | "cached" | "unavailable";
  linkedReferences?: unknown[];
  linkedReferenceWarnings?: string[];
  asOf?: string;
  chatHistory?: Array<{ role: string; content: string }>;
  sourceFreshness?: {
    latestTimelineAt?: string | null;
    latestSignalAt?: string | null;
    clickupLastSyncAt?: string | null;
    slackLastSyncAt?: string | null;
  };
}): string {
  const parts: string[] = [];
  if (ctx.asOf) {
    parts.push(
      `Freshness policy: current time is ${ctx.asOf}. Answer the current project state as of this time. Explicit PM facts and the newest structured meeting memory define scope and commitments; live ClickUp and Slack evidence update their current status. Prefer those sources over older transcript chunks. Treat undated project memory as background context, not proof that something is still current. State uncertainty when sources conflict.`,
    );
  }
  if (ctx.sourceFreshness) {
    parts.push(
      `Evidence timestamps (these are the truth boundary, not a guarantee of live synchronization):\n${JSON.stringify(ctx.sourceFreshness, null, 2)}\nNever imply the project is current beyond the newest relevant evidence timestamp. If a connected source is stale or has never synced, disclose that briefly when it affects the answer.`,
    );
  }
  parts.push(buildProjectIdentityBlock(ctx));
  if (ctx.operatingCadence) {
    parts.push(
      `Project operating cadence:\n${JSON.stringify(ctx.operatingCadence, null, 2)}\nFor a weekly cadence, the current delivery cycle starts at the latest meeting and ends at the next meeting. "This week" means work committed or actively progressed inside that cycle. A "next-meeting deliverable" is something the team expects to show, review, decide, or hand over at that meeting — it is not every active task.`,
    );
  }
  if (ctx.projectFacts?.length) {
    parts.push(
      `Explicit PM facts and corrections (highest-priority project memory; newer facts supersede older assumptions):\n${JSON.stringify(ctx.projectFacts, null, 2)}`,
    );
  }
  if (ctx.meetingMemories?.length) {
    parts.push(
      `Structured meeting memory (newest first):\n${JSON.stringify(ctx.meetingMemories, null, 2)}\nUse the newest meeting as the planning anchor. Use older meetings only for history or when the latest meeting explicitly carries work forward. Do not promote a discussion item, operational follow-up, or old plan into a next-meeting deliverable without evidence.`,
    );
  }
  if (ctx.chatHistory?.length) {
    parts.push(
      `Recent conversation (for continuity only; it is not project knowledge):\n${ctx.chatHistory
        .map((message) => `${message.role}: ${message.content.slice(0, 1200)}`)
        .join("\n\n")}`,
    );
  }
  if (ctx.profile) parts.push(`Project memory:\n${JSON.stringify(ctx.profile, null, 2)}`);
  if (ctx.chunks.length > 0) {
    parts.push(
      `Retrieved project evidence (cite document-backed claims with the exact source labels [S1], [S2], etc.; never invent a label):\n${
        ctx.chunks.map((chunk, index) => {
          const metadata = chunk.metadata ?? {};
          const citationId = typeof metadata.citation_id === "string" ? metadata.citation_id : `S${index + 1}`;
          const title = typeof metadata.source_title === "string" ? metadata.source_title : "Untitled source";
          const sourceType = typeof metadata.source_type === "string" ? metadata.source_type : chunk.category ?? "unknown";
          const section = typeof metadata.section_path === "string" && metadata.section_path ? ` | section=${metadata.section_path}` : "";
          const updated = typeof metadata.source_updated_at === "string" && metadata.source_updated_at
            ? ` | updated=${metadata.source_updated_at}`
            : typeof metadata.source_created_at === "string" && metadata.source_created_at
            ? ` | created=${metadata.source_created_at}`
            : "";
          const url = typeof metadata.canonical_url === "string" && metadata.canonical_url ? ` | url=${metadata.canonical_url}` : "";
          return `[${citationId}] ${title} | type=${sourceType}${section}${updated}${url} | relevance=${chunk.similarity?.toFixed(3) ?? "n/a"}\n${chunk.content.slice(0, 4500)}`;
        }).join("\n\n")
      }`,
    );
  }
  if (ctx.clickupTasks) {
    parts.push(
      `Current ClickUp task snapshot (${ctx.clickupTaskSnapshotSource ?? "unavailable"}; ${ctx.clickupTasks.length} tasks checked):\n${JSON.stringify(ctx.clickupTasks, null, 2)}\nUse this snapshot to prevent duplicate task suggestions. A semantically equivalent task counts as existing even when wording differs. Closed/completed tasks count as historical coverage, but create a new task only when the meeting clearly introduces distinct follow-up work.`,
    );
  }
  if (ctx.slackMessages?.length) {
    parts.push(
      `Recent connected Slack context (${ctx.slackContextSource ?? "cached"}; ${ctx.slackMessages.length} messages):\n${JSON.stringify(ctx.slackMessages, null, 2)}\nCheck this context for existing answers and decisions before asking a clarification question. Cached context is current only through slackLastSyncAt.`,
    );
  }
  if (ctx.linkedReferences?.length) {
    parts.push(
      `Explicit links resolved live for this message (highest-priority evidence for the linked item):\n${JSON.stringify(ctx.linkedReferences, null, 2)}\nUse the exact linked message, thread, task, or comment before broader project context. Never imply that a link was read when it is absent from this block.`,
    );
  }
  if (ctx.linkedReferenceWarnings?.length) {
    parts.push(
      `Explicit link resolution warnings:\n${ctx.linkedReferenceWarnings.join("\n")}\nDo not claim to have read a link that failed resolution. Ask the user to verify access or the link when it blocks the request.`,
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

const CHAT_RESPONSE_SCHEMA = `Return strict JSON:
{
  "detected_intent": "answer | add_clickup_comment",
  "answer": "string",
  "fact_updates": [{
    "fact_key": "stable-kebab-case-key",
    "subject": "string",
    "statement": "string",
    "state": "string|null",
    "effective_date": "YYYY-MM-DD|null",
    "explicit_user_fact": true,
    "confidence": 1.0
  }],
  "tool_calls": [{
    "tool_name": "add_clickup_comment",
    "requires_confirmation": true,
    "input": {
      "task_id": "string",
      "task_name": "string",
      "task_url": "string",
      "comment_text": "string",
      "source_links": ["string"]
    }
  }],
  "summary": "string",
  "confidence": 0.0
}
Rules:
- Answer the user's question directly from the supplied project evidence.
- Before answering or identifying missing information, check the supplied ClickUp task snapshot and recent Slack context for an existing answer, decision, owner, status, or related work.
- For questions about "this week", "next meeting", priorities, or deliverables, anchor the answer on the newest structured meeting and the operating cadence. Then reconcile each candidate item against explicit PM facts and live ClickUp/Slack status.
- Separate current work, expected next-meeting deliverables, and items already finished/ready for client feedback. A task in Client Review, Complete, Live, or Billing is not upcoming implementation work unless newer evidence explicitly reopens it.
- Never turn every active task or every meeting action into a next-meeting deliverable. Include only an explicit meeting commitment or a strongly evidenced artifact the team expects to show/review at the next cadence meeting.
- If meeting dates are known, state the latest and next meeting dates. If the next date is cadence-derived rather than explicitly scheduled, label it as expected.
- Format the answer as readable Markdown, never as one dense paragraph. Use a short title when useful and 2–4 descriptive section headings. Mix concise prose with lists: bullets are only for genuinely parallel action items, not for every status, note, or source line. Keep paragraphs to at most 2 sentences and lists compact.
- For a Slack/ClickUp comparison, use: "## Slack & ClickUp review", a one-sentence conclusion, "### What changed", "### ClickUp actions", and optionally "### Already covered" or "### Needs clarification". Keep only sections that add value, cap each list at 4 items, and never repeat the same work item in multiple sections.
- For weekly-planning answers, prefer this structure when the sections are relevant: "## Weekly plan · date range", "### In progress", "### Next meeting · date", "### Ready for feedback", and "### Needs clarification". Omit empty sections.
- Bold short labels or statuses such as **Owner**, **Ready for feedback**, or **Blocked**, but do not over-format every sentence.
- Do not add a dedicated source-freshness section when connected evidence is current. Mention stale, missing, or conflicting evidence only when it changes the answer.
- Lead with the current state or conclusion, then use short sections or bullets.
- Default to 350 words or fewer. Offer deeper detail only when useful.
- Distinguish confirmed facts, reasonable inference, and missing/stale evidence.
- If the supplied evidence does not support the requested detail, say that it was not found in the connected project sources instead of filling the gap from general knowledge.
- Cite claims grounded in Retrieved project evidence with its exact labels, for example [S1]. Put citations immediately after the supported sentence or bullet. Never cite a label that was not supplied, and do not cite conversation history as evidence.
- fact_updates is ONLY for durable facts or corrections explicitly stated by the user in the current message (for example, "Rich Text is finished and with Vegard for review" or "we meet every Friday"). Never store a question, model inference, ClickUp/Slack observation, or assistant answer as a fact. Otherwise return [].
- Ordinary Q&A must not propose tools, external actions, tasks, general memory updates, or clarification workflows.
- Exception: when the user explicitly asks to add/create/post/prepare a ClickUp comment, return exactly one add_clickup_comment tool call with the real target task ID, task name, URL, and a complete comment draft. Use a directly linked ClickUp task when supplied; otherwise identify one unambiguous task from the live snapshot. If the target is ambiguous, return no tool call and ask for the task link.
- A requested ClickUp comment is always confirmation-gated. The answer should only say that the action is ready for review; do not repeat the full draft in the answer.
- Base a comment about a shared Slack or ClickUp URL on the Explicit links resolved live block. If the link could not be resolved, return no tool call and explain that briefly.
- Never include @mentions, Slack mention markup, or language that calls out/directly addresses the client in a ClickUp comment unless the current user message explicitly asks to tag or mention them. Neutral names used as factual attribution are allowed.`;

const CHAT_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    detected_intent: { type: "string", enum: ["answer", "add_clickup_comment"] },
    answer: { type: "string", description: "A concise Markdown answer under 350 words." },
    fact_updates: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fact_key: { type: "string" },
          subject: { type: "string" },
          statement: { type: "string" },
          state: { type: ["string", "null"] },
          effective_date: { type: ["string", "null"] },
          explicit_user_fact: { type: "boolean", enum: [true] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "fact_key",
          "subject",
          "statement",
          "state",
          "effective_date",
          "explicit_user_fact",
          "confidence",
        ],
      },
    },
    tool_calls: {
      type: "array",
      maxItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool_name: { type: "string", enum: ["add_clickup_comment"] },
          requires_confirmation: { type: "boolean", enum: [true] },
          input: {
            type: "object",
            additionalProperties: false,
            properties: {
              task_id: { type: "string" },
              task_name: { type: "string" },
              task_url: { type: "string" },
              comment_text: { type: "string" },
              source_links: { type: "array", items: { type: "string" } },
            },
            required: ["task_id", "task_name", "task_url", "comment_text", "source_links"],
          },
        },
        required: ["tool_name", "requires_confirmation", "input"],
      },
    },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["detected_intent", "answer", "fact_updates", "tool_calls", "summary", "confidence"],
};

const FILE_REVIEW_SCHEMA = `Return strict JSON:
{
  "detected_intent": "meeting_review",
  "answer": "string",
  "memory_updates": {},
  "meeting_memory": {
    "title": "string",
    "meeting_date": "YYYY-MM-DD|null",
    "meeting_date_source": "transcript|filename|inferred|unknown",
    "next_meeting_date": "YYYY-MM-DD|null",
    "cadence_signal": "weekly|other|unknown",
    "summary": "string",
    "decisions": ["string"],
    "completed_or_demo": ["string"],
    "current_week_focus": ["string"],
    "next_meeting_deliverables": [{
      "title": "string",
      "evidence": "string",
      "owner": "string|null",
      "status": "planned|in_progress|ready_for_demo|blocked|done",
      "confidence": 0.0
    }],
    "feedback": ["string"],
    "open_questions": ["string"],
    "participants": ["string"],
    "confidence": 0.0
  },
  "proposed_tasks": [],
  "clarification_questions": [{
    "question": "string",
    "reason": "string",
    "importance": "low|medium|high",
    "blocks_task_creation": false
  }],
  "tool_calls": [{
    "tool_name": "create_clickup_task",
    "requires_confirmation": true,
    "input": {
      "title": "string",
      "description": "string",
      "priority": "low|medium|high|urgent",
      "due_date_hint": "string|null",
      "assignee_hint": "string|null",
      "destination": { "type": "list", "id": "string", "name": "string", "path": "string", "reason": "string" },
      "source_context": { "meeting_action": "string", "evidence": "string" }
    }
  }],
  "workflows": [],
  "summary": "string",
  "confidence": 0.0
}
Rules:
- Review the uploaded meeting as a PM, not merely as a summarizer.
- Extract concrete action items, decisions, unresolved ownership, dependencies, and follow-ups.
- Build meeting_memory as a dated, reusable project record. Separate work already completed or being demonstrated from current-cycle focus and from explicit next-meeting deliverables.
- A next-meeting deliverable must be an artifact, result, decision, or demo the team committed to show/review at the next meeting. Do not classify every action item as a deliverable.
- When a work item is already finished, in demo, or in client review, put it in completed_or_demo and do not also list it as future work unless the meeting explicitly requests a new follow-up.
- Use a date encoded in the recording filename when present. Treat a weekly pattern or an explicit statement about weekly meetings as cadence_signal=weekly.
- Compare every concrete action item against the Current ClickUp task snapshot. Match by meaning, not exact wording.
- In answer, use only the relevant short sections from: Decisions, Already covered in ClickUp, Suggested new tasks. Omit empty sections.
- Format answer as readable Markdown with section headings and short bullet lists. Never return a dense wall of prose.
- Never include a Questions or Questions to clarify section, clarification question objects, or their reasons in answer. clarification_questions are rendered separately as interactive controls.
- Ask up to 3 specific, answerable clarification questions that materially improve ownership, scope, due date, acceptance criteria, or whether work is still required. Never ask generic questions such as "Anything else?".
- For each high-confidence action item with no semantically equivalent ClickUp task, emit one create_clickup_task tool call. It will only become a pending confirmation card; do not claim it was created.
- Do not emit a task for a vague discussion, completed work, a low-priority idea explicitly deferred, or an item that needs clarification first.
- Never duplicate an existing open, in-progress, or completed ClickUp task unless the meeting clearly defines distinct new follow-up work.
- If the task snapshot source is unavailable, state that ClickUp could not be verified and emit no create_clickup_task calls.
- Use the existing ClickUp hierarchy to choose the best destination list. Never create or reorganize folders/lists.
- Keep memory_updates, proposed_tasks, and workflows empty.`;

const MEETING_MEMORY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    meeting_date: { type: ["string", "null"] },
    meeting_date_source: { type: "string", enum: ["transcript", "filename", "inferred", "unknown"] },
    next_meeting_date: { type: ["string", "null"] },
    cadence_signal: { type: "string", enum: ["weekly", "other", "unknown"] },
    summary: { type: "string" },
    decisions: { type: "array", maxItems: 12, items: { type: "string" } },
    completed_or_demo: { type: "array", maxItems: 12, items: { type: "string" } },
    current_week_focus: { type: "array", maxItems: 12, items: { type: "string" } },
    next_meeting_deliverables: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          evidence: { type: "string" },
          owner: { type: ["string", "null"] },
          status: { type: "string", enum: ["planned", "in_progress", "ready_for_demo", "blocked", "done"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["title", "evidence", "owner", "status", "confidence"],
      },
    },
    feedback: { type: "array", maxItems: 12, items: { type: "string" } },
    open_questions: { type: "array", maxItems: 12, items: { type: "string" } },
    participants: { type: "array", maxItems: 30, items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "title",
    "meeting_date",
    "meeting_date_source",
    "next_meeting_date",
    "cadence_signal",
    "summary",
    "decisions",
    "completed_or_demo",
    "current_week_focus",
    "next_meeting_deliverables",
    "feedback",
    "open_questions",
    "participants",
    "confidence",
  ],
};

const FILE_REVIEW_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    detected_intent: { type: "string", enum: ["meeting_review"] },
    answer: {
      type: "string",
      description: "A concise PM review under 900 words with only relevant sections.",
    },
    memory_updates: { type: "object", additionalProperties: false, properties: {} },
    meeting_memory: MEETING_MEMORY_JSON_SCHEMA,
    proposed_tasks: { type: "array", maxItems: 0, items: { type: "string" } },
    clarification_questions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          importance: { type: "string", enum: ["low", "medium", "high"] },
          blocks_task_creation: { type: "boolean" },
        },
        required: ["question", "reason", "importance", "blocks_task_creation"],
      },
    },
    tool_calls: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool_name: { type: "string", enum: ["create_clickup_task"] },
          requires_confirmation: { type: "boolean", enum: [true] },
          input: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string", description: "Concise objective, context, and acceptance criteria." },
              priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
              due_date_hint: { type: ["string", "null"] },
              assignee_hint: { type: ["string", "null"] },
              destination: {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: { type: "string", enum: ["list"] },
                  id: { type: "string" },
                  name: { type: "string" },
                  path: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["type", "id", "name", "path", "reason"],
              },
              source_context: {
                type: "object",
                additionalProperties: false,
                properties: {
                  meeting_action: { type: "string" },
                  evidence: { type: "string" },
                },
                required: ["meeting_action", "evidence"],
              },
            },
            required: [
              "title",
              "description",
              "priority",
              "due_date_hint",
              "assignee_hint",
              "destination",
              "source_context",
            ],
          },
        },
        required: ["tool_name", "requires_confirmation", "input"],
      },
    },
    workflows: { type: "array", maxItems: 0, items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "detected_intent",
    "answer",
    "memory_updates",
    "meeting_memory",
    "proposed_tasks",
    "clarification_questions",
    "tool_calls",
    "workflows",
    "summary",
    "confidence",
  ],
};

export async function generateAgentPlan(args: {
  inputText: string;
  mode: AgentMode;
  context: Parameters<typeof buildAgentContextBlock>[0];
  trace?: TraceMetadata;
  isChat?: boolean;
  reviewUploadedFiles?: boolean;
}): Promise<{ plan: AgentPlan; model: string; usage: OpenRouterUsage; traceId: string | null; generationId: string | null }> {
  const modeHint = args.isChat && args.mode === "answer_only"
    ? "Answer-only mode for ordinary questions. The only allowed action is a confirmation-gated add_clickup_comment when the user explicitly requests that exact action; explicit user-stated project facts may still be captured in fact_updates."
    : args.mode === "auto"
    ? "Detect intent automatically."
    : `Forced mode: ${args.mode}.`;

  const { data, model, usage, traceId, generationId } = await generateStructuredObject<AgentPlan>({
    trace: { ...args.trace, prompt_type: "generateAgentPlan", chunks_retrieved_count: args.context.chunks.length },
    traceName: "generateAgentPlan",
    schemaDescription: args.reviewUploadedFiles ? FILE_REVIEW_SCHEMA : args.isChat ? CHAT_RESPONSE_SCHEMA : AGENT_PLAN_SCHEMA,
    jsonSchema: args.reviewUploadedFiles
      ? { name: "project_meeting_review", schema: FILE_REVIEW_JSON_SCHEMA }
      : args.isChat
      ? { name: "project_chat_response", schema: CHAT_RESPONSE_JSON_SCHEMA }
      : undefined,
    reasoningEffort: args.reviewUploadedFiles || args.isChat ? "low" : undefined,
    model: args.isChat ? Deno.env.get("OPENROUTER_CHAT_MODEL")?.trim() || "openai/gpt-5-mini" : undefined,
     maxTokens: args.reviewUploadedFiles
       ? Number(Deno.env.get("OPENROUTER_FILE_REVIEW_MAX_TOKENS") ?? "6000")
       : args.isChat
       ? Number(Deno.env.get("OPENROUTER_CHAT_MAX_TOKENS") ?? "1800")
       : undefined,
    systemPrompt: [
      "You are the OXUS Cloud project agent.",
       args.reviewUploadedFiles
         ? "You are reviewing newly uploaded meeting evidence inside project chat. Build durable dated meeting memory, reconcile action items against the supplied ClickUp task snapshot, ask targeted questions, and prepare only confirmation-gated task suggestions."
       : args.isChat
        ? "You are in the project's persistent chat. Give a direct, useful answer that reflects the freshest available project state. For weekly planning, anchor on the latest structured meeting and reconcile it with live ClickUp and Slack. Use the recent conversation only for continuity."
        : "This is a single-shot intake, NOT a chat.",
      "Plan safe actions; external side effects require confirmation. Never tag, mention, ping, notify, or directly call out a client in a ClickUp comment unless the current user message explicitly requests it.",
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
    userPrompt: `Project context:\n${buildAgentContextBlock(args.context)}\n\nCurrent user message:\n${args.inputText}`,
  });

  const plan: AgentPlan = {
    detected_intent: data.detected_intent ?? "mixed",
    answer: data.answer ?? null,
    memory_updates: data.memory_updates ?? {},
    meeting_memory: data.meeting_memory ?? null,
    fact_updates: (data.fact_updates ?? [])
      .filter((fact) => fact?.explicit_user_fact === true)
      .slice(0, 6),
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

  return { plan, model, usage, traceId, generationId };
}

const CLICKUP_COMMENT_DRAFT_SCHEMA = `Return strict JSON:
{
  "comment_text": "string",
  "summary": "string",
  "confidence": 0.0
}
Rules:
- Write only the comment that belongs on the specified ClickUp task. Do not include meta text such as "paste this", "recommended comment", or an analysis outside the comment.
- Base the comment primarily on Explicit links resolved live. Use broader project memory only to clarify established context; never let older memory override the linked evidence.
- Summarize the decision/current state, material risk or constraint, and concrete next steps. Keep it concise and operational.
- Do not include internal retrieval citations such as [S1] or [S8]. Source links may be included only when they help the ClickUp reader.
- Never tag, ping, mention, notify, or directly address a person unless mention permission is explicitly true.
- When mention permission is false, use neutral owner/status wording and do not include @mentions, Slack markup, "Name — please...", or "tagging Name" language.
- Do not invent decisions, owners, deadlines, access, or completion states.`;

const CLICKUP_COMMENT_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    comment_text: { type: "string", minLength: 1, maxLength: 8000 },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["comment_text", "summary", "confidence"],
};

export async function generateClickupCommentDraft(args: {
  inputText: string;
  context: Parameters<typeof buildAgentContextBlock>[0];
  targetTask: { id: string; name: string; url?: string | null };
  allowMentions: boolean;
  trace?: TraceMetadata;
}): Promise<{
  commentText: string;
  summary: string;
  confidence: number;
  model: string;
  usage: OpenRouterUsage;
  traceId: string | null;
  generationId: string | null;
}> {
  const result = await generateStructuredObject<{
    comment_text: string;
    summary: string;
    confidence: number;
  }>({
    trace: { ...args.trace, prompt_type: "generateClickupCommentDraft", chunks_retrieved_count: args.context.chunks.length },
    traceName: "generateClickupCommentDraft",
    schemaDescription: CLICKUP_COMMENT_DRAFT_SCHEMA,
    jsonSchema: { name: "clickup_comment_draft", schema: CLICKUP_COMMENT_DRAFT_JSON_SCHEMA },
    reasoningEffort: "low",
    model: Deno.env.get("OPENROUTER_CHAT_MODEL")?.trim() || "openai/gpt-5-mini",
    maxTokens: Number(Deno.env.get("OPENROUTER_CLICKUP_ACTION_MAX_TOKENS") ?? "1800"),
    systemPrompt: [
      "You are the ClickUp action planner inside OXUS Cloud.",
      "The user explicitly requested a ClickUp comment, but nothing may be posted until they confirm the generated action card.",
      `Mention permission is ${args.allowMentions ? "true" : "false"}.`,
      "Return the final editable comment body, not a conversational answer.",
    ].join(" "),
    userPrompt: `Target ClickUp task:\n${JSON.stringify(args.targetTask, null, 2)}\n\nProject context:\n${buildAgentContextBlock(args.context)}\n\nUser request:\n${args.inputText}`,
  });
  return {
    commentText: result.data.comment_text.trim(),
    summary: result.data.summary.trim(),
    confidence: result.data.confidence,
    model: result.model,
    usage: result.usage,
    traceId: result.traceId,
    generationId: result.generationId,
  };
}

export async function generateMeetingMemory(args: {
  sourceTitle: string;
  sourceText: string;
  meetingDateHint?: string | null;
  existingReview?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  trace?: TraceMetadata;
}): Promise<{
  memory: ProjectMeetingMemory;
  model: string;
  usage: OpenRouterUsage;
  traceId: string | null;
  generationId: string | null;
}> {
  const result = await generateStructuredObject<ProjectMeetingMemory>({
    trace: { ...args.trace, prompt_type: "generateMeetingMemory" },
    traceName: "generateMeetingMemory",
    model: Deno.env.get("OPENROUTER_MEETING_MEMORY_MODEL")?.trim()
      || Deno.env.get("OPENROUTER_CHAT_MODEL")?.trim()
      || "openai/gpt-5-mini",
    maxTokens: Number(Deno.env.get("OPENROUTER_MEETING_MEMORY_MAX_TOKENS") ?? "3500"),
    reasoningEffort: "low",
    jsonSchema: { name: "project_meeting_memory", schema: MEETING_MEMORY_JSON_SCHEMA },
    schemaDescription: `Extract one durable project-meeting memory object.
Rules:
- Use only the supplied meeting evidence. Do not invent a commitment.
- Separate decisions, work already completed/being demonstrated, current-cycle focus, and explicit next-meeting deliverables.
- A next-meeting deliverable is an artifact, result, decision, or demo the team committed to show or review at the next meeting. It is not every action item.
- If an item is already complete, in demo, or awaiting client feedback, keep it under completed_or_demo and do not describe it as upcoming implementation work.
- Use the deterministic date hint when supplied and set meeting_date_source=filename.
- A weekly statement or a sequence of weekly meetings is cadence_signal=weekly; otherwise use unknown.
- Keep evidence concise and specific.`,
    systemPrompt: [
      "You are an exacting project manager building compact temporal memory from meeting evidence.",
      oxusIdentityGuidance({ projectName: args.projectName, clientName: args.clientName }),
    ].join(" "),
    userPrompt: [
      `Source: ${args.sourceTitle}`,
      `Deterministic meeting date hint: ${args.meetingDateHint ?? "none"}`,
      args.existingReview ? `Earlier AI review (secondary evidence; it may contain mistaken classifications):\n${args.existingReview.slice(0, 8000)}` : "",
      `Meeting transcript:\n${args.sourceText.slice(0, 70000)}`,
    ].filter(Boolean).join("\n\n"),
  });
  return { memory: result.data, model: result.model, usage: result.usage, traceId: result.traceId, generationId: result.generationId };
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
