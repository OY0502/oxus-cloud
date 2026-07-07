import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildSuppressedQuestionKeys,
  mergeAppendStringArrays,
  mergeRefreshedStringArrays,
} from "../_shared/memoryMerge.ts";
import { reconcileProjectAttentionItems } from "../_shared/agent/attentionReconciliation.ts";

type DetectedSourceType =
  | "meeting_transcript"
  | "slack_summary"
  | "client_feedback"
  | "project_description"
  | "requirements_doc"
  | "design_notes"
  | "qa_notes"
  | "technical_notes"
  | "delivery_update"
  | "uploaded_file"
  | "unknown";

type KnowledgeSourceType =
  | DetectedSourceType
  | "manual"
  | "zoom_transcript"
  | "figma"
  | "clickup"
  | "slack"
  | "other"
  | "auto";

type BriefSourceType = "manual" | "zoom_transcript" | "project_description" | "other";
type InputMethod = "text" | "file" | "api";
type Priority = "low" | "medium" | "high" | "urgent";
type QaPriority = "low" | "medium" | "high";
type AttentionImportance = "low" | "medium" | "high";

type RequestBody = {
  project_id?: string;
  source_type?: KnowledgeSourceType;
  source_text?: string;
  input_text?: string;
  source_title?: string;
  input_method?: InputMethod;
  file_name?: string;
  mime_type?: string;
  metadata?: Record<string, unknown>;
};

type ErrorCode =
  | "AUTH_REQUIRED"
  | "CONFIG_ERROR"
  | "INVALID_INPUT"
  | "PROJECT_NOT_FOUND"
  | "DB_ERROR"
  | "OPENROUTER_ERROR"
  | "AI_PARSE_ERROR"
  | "UNEXPECTED_ERROR";

type AiQaScenario = {
  title: string;
  steps: string[];
  expected_result: string;
  priority: QaPriority;
};

type AiTask = {
  title: string;
  description: string;
  acceptance_criteria: string[];
  qa_scenarios: AiQaScenario[];
  priority: Priority;
  confidence: number;
  source_reason?: string;
};

type AiClarificationQuestion = {
  question: string;
  reason: string;
  importance: AttentionImportance;
  blocks_task_creation: boolean;
};

type AiMemoryUpdates = {
  business_goal: string | null;
  target_users: string[];
  core_flows: string[];
  success_criteria: string[];
  scope_in: string[];
  scope_out: string[];
  risks: string[];
  open_questions: string[];
  delivery_notes: string[];
  qa_strategy: string | null;
};

type AiProjectProfile = {
  business_goal: string;
  target_users: string[];
  core_flows: string[];
  scope_in: string[];
  scope_out: string[];
  success_criteria: string[];
  assumptions: string[];
  constraints: string[];
  risks: string[];
  open_questions: string[];
  qa_strategy: string;
  technical_notes: string[];
  delivery_notes: string[];
  current_phase: string;
  confidence: number;
};

type AiBrief = {
  summary: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  risks: string[];
  open_questions: string[];
  qa_notes: string[];
};

type AiResponse = {
  detected_source_type: DetectedSourceType;
  memory_updates: AiMemoryUpdates;
  proposed_tasks: AiTask[];
  clarification_questions: AiClarificationQuestion[];
  summary: string;
  confidence: number;
  project_profile: AiProjectProfile;
  brief: AiBrief;
  tasks: AiTask[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const detectedSourceTypes = new Set<DetectedSourceType>([
  "meeting_transcript",
  "slack_summary",
  "client_feedback",
  "project_description",
  "requirements_doc",
  "design_notes",
  "qa_notes",
  "technical_notes",
  "delivery_update",
  "uploaded_file",
  "unknown",
]);

const legacyKnowledgeSourceTypes = new Set<KnowledgeSourceType>([
  "manual",
  "uploaded_file",
  "zoom_transcript",
  "project_description",
  "figma",
  "clickup",
  "slack",
  "other",
  "auto",
  ...detectedSourceTypes,
]);

const inputMethods = new Set<InputMethod>(["text", "file", "api"]);
const priorities = new Set<Priority>(["low", "medium", "high", "urgent"]);
const qaPriorities = new Set<QaPriority>(["low", "medium", "high"]);
const attentionImportance = new Set<AttentionImportance>(["low", "medium", "high"]);
const minSourceChars = 20;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, status: number, code: ErrorCode, details?: string) {
  if (status >= 500) console.error(`[${code}] ${error}`, details ?? "");
  return jsonResponse({ error, details, code }, status);
}

function getPublishableKey(): string | null {
  const directKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (directKey) return directKey;

  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!publishableKeys) return null;
  try {
    const parsed = JSON.parse(publishableKeys) as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

function requiredEnv(name: string): string | Response {
  const value = Deno.env.get(name);
  if (!value?.trim()) {
    return errorResponse(`Missing required environment variable: ${name}.`, 500, "CONFIG_ERROR");
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function asQaScenarios(value: unknown): AiQaScenario[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      steps: asStringArray(item.steps),
      expected_result: typeof item.expected_result === "string" ? item.expected_result.trim() : "",
      priority: qaPriorities.has(item.priority as QaPriority) ? (item.priority as QaPriority) : "medium",
    }))
    .filter((item) => item.title);
}

function asTasks(value: unknown): AiTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      description: typeof item.description === "string" ? item.description.trim() : "",
      acceptance_criteria: asStringArray(item.acceptance_criteria),
      qa_scenarios: asQaScenarios(item.qa_scenarios),
      priority: priorities.has(item.priority as Priority) ? (item.priority as Priority) : "medium",
      confidence: clampConfidence(item.confidence) ?? 0.7,
      source_reason: typeof item.source_reason === "string" ? item.source_reason.trim() : undefined,
    }))
    .filter((item) => item.title);
}

function asClarificationQuestions(value: unknown): AiClarificationQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      question: typeof item.question === "string" ? item.question.trim() : "",
      reason: typeof item.reason === "string" ? item.reason.trim() : "",
      importance: attentionImportance.has(item.importance as AttentionImportance)
        ? (item.importance as AttentionImportance)
        : "medium",
      blocks_task_creation: item.blocks_task_creation === true,
    }))
    .filter((item) => item.question)
    .slice(0, 3);
}

function extractJson(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return unfenced;
  return unfenced.slice(start, end + 1);
}

function parseMemoryUpdates(value: unknown): AiMemoryUpdates {
  const mem = (value ?? {}) as Record<string, unknown>;
  return {
    business_goal: typeof mem.business_goal === "string" ? mem.business_goal.trim() || null : null,
    target_users: asStringArray(mem.target_users),
    core_flows: asStringArray(mem.core_flows),
    success_criteria: asStringArray(mem.success_criteria),
    scope_in: asStringArray(mem.scope_in),
    scope_out: asStringArray(mem.scope_out),
    risks: asStringArray(mem.risks),
    open_questions: asStringArray(mem.open_questions),
    delivery_notes: asStringArray(mem.delivery_notes),
    qa_strategy: typeof mem.qa_strategy === "string" ? mem.qa_strategy.trim() || null : null,
  };
}

function memoryUpdatesToProfile(mem: AiMemoryUpdates, confidence: number): AiProjectProfile {
  return {
    business_goal: mem.business_goal ?? "",
    target_users: mem.target_users,
    core_flows: mem.core_flows,
    scope_in: mem.scope_in,
    scope_out: mem.scope_out,
    success_criteria: mem.success_criteria,
    assumptions: [],
    constraints: [],
    risks: mem.risks,
    open_questions: mem.open_questions,
    qa_strategy: mem.qa_strategy ?? "",
    technical_notes: [],
    delivery_notes: mem.delivery_notes,
    current_phase: "",
    confidence,
  };
}

function parseAiJson(content: string): AiResponse {
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;

  // New schema (preferred)
  if (parsed.memory_updates || parsed.detected_source_type || parsed.proposed_tasks) {
    const detected = detectedSourceTypes.has(parsed.detected_source_type as DetectedSourceType)
      ? (parsed.detected_source_type as DetectedSourceType)
      : "unknown";
    const memoryUpdates = parseMemoryUpdates(parsed.memory_updates);
    const confidence = clampConfidence(parsed.confidence) ?? 0;
    const tasks = asTasks(parsed.proposed_tasks);
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const profile = memoryUpdatesToProfile(memoryUpdates, confidence);

    return {
      detected_source_type: detected,
      memory_updates: memoryUpdates,
      proposed_tasks: tasks,
      clarification_questions: asClarificationQuestions(parsed.clarification_questions),
      summary,
      confidence,
      project_profile: profile,
      brief: {
        summary,
        goals: memoryUpdates.success_criteria.slice(0, 5),
        scope_in: memoryUpdates.scope_in,
        scope_out: memoryUpdates.scope_out,
        risks: memoryUpdates.risks,
        open_questions: memoryUpdates.open_questions,
        qa_notes: memoryUpdates.qa_strategy ? [memoryUpdates.qa_strategy] : [],
      },
      tasks,
    };
  }

  // Legacy schema fallback
  const profile = (parsed.project_profile ?? {}) as Record<string, unknown>;
  const brief = (parsed.brief ?? {}) as Record<string, unknown>;
  const tasks = asTasks(parsed.tasks);
  const legacyProfile: AiProjectProfile = {
    business_goal: typeof profile.business_goal === "string" ? profile.business_goal.trim() : "",
    target_users: asStringArray(profile.target_users),
    core_flows: asStringArray(profile.core_flows),
    scope_in: asStringArray(profile.scope_in),
    scope_out: asStringArray(profile.scope_out),
    success_criteria: asStringArray(profile.success_criteria),
    assumptions: asStringArray(profile.assumptions),
    constraints: asStringArray(profile.constraints),
    risks: asStringArray(profile.risks),
    open_questions: asStringArray(profile.open_questions),
    qa_strategy: typeof profile.qa_strategy === "string" ? profile.qa_strategy.trim() : "",
    technical_notes: asStringArray(profile.technical_notes),
    delivery_notes: asStringArray(profile.delivery_notes),
    current_phase: typeof profile.current_phase === "string" ? profile.current_phase.trim() : "",
    confidence: clampConfidence(profile.confidence) ?? 0,
  };

  return {
    detected_source_type: "unknown",
    memory_updates: {
      business_goal: legacyProfile.business_goal || null,
      target_users: legacyProfile.target_users,
      core_flows: legacyProfile.core_flows,
      success_criteria: legacyProfile.success_criteria,
      scope_in: legacyProfile.scope_in,
      scope_out: legacyProfile.scope_out,
      risks: legacyProfile.risks,
      open_questions: legacyProfile.open_questions,
      delivery_notes: legacyProfile.delivery_notes,
      qa_strategy: legacyProfile.qa_strategy || null,
    },
    proposed_tasks: tasks,
    clarification_questions: [],
    summary: typeof brief.summary === "string" ? brief.summary.trim() : "",
    confidence: legacyProfile.confidence,
    project_profile: legacyProfile,
    brief: {
      summary: typeof brief.summary === "string" ? brief.summary.trim() : "",
      goals: asStringArray(brief.goals),
      scope_in: asStringArray(brief.scope_in),
      scope_out: asStringArray(brief.scope_out),
      risks: asStringArray(brief.risks),
      open_questions: asStringArray(brief.open_questions),
      qa_notes: asStringArray(brief.qa_notes),
    },
    tasks,
  };
}

function chunkText(text: string, chunkSize: number) {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += chunkSize) {
    chunks.push(text.slice(start, start + chunkSize));
  }
  return chunks;
}

function briefSourceType(sourceType: KnowledgeSourceType): BriefSourceType {
  if (sourceType === "zoom_transcript" || sourceType === "meeting_transcript") return "zoom_transcript";
  if (sourceType === "project_description") return "project_description";
  if (sourceType === "other" || sourceType === "unknown") return "other";
  return "manual";
}

function resolveStoredSourceType(
  requested: KnowledgeSourceType,
  detected: DetectedSourceType,
  inputMethod: InputMethod,
): KnowledgeSourceType {
  if (requested !== "auto") {
    if (requested === "manual" && inputMethod === "file") return "uploaded_file";
    return requested;
  }
  if (inputMethod === "file" && detected === "unknown") return "uploaded_file";
  return detected;
}

function normalizeQuestionKey(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

async function callOpenRouter({
  baseUrl,
  apiKey,
  model,
  messages,
  siteUrl,
  appName,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  siteUrl?: string;
  appName: string;
}) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
      "X-Title": appName,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    const details = `model=${model}; status=${response.status}; response=${responseText.slice(0, 1200)}`;
    console.error("[OPENROUTER_ERROR]", details);
    throw new Error(details);
  }

  let completion: unknown;
  try {
    completion = JSON.parse(responseText);
  } catch {
    const details = `model=${model}; status=${response.status}; response=${responseText.slice(0, 1200)}`;
    console.error("[OPENROUTER_ERROR] Non-JSON completion wrapper", details);
    throw new Error(details);
  }

  const content = (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`model=${model}; status=${response.status}; response=empty message content`);
  }
  return { completion, content };
}

function buildExtractiveChunkDigest(chunks: string[]): string {
  const maxDigestChars = Number(Deno.env.get("AI_MAX_DIGEST_CHARS") ?? "50000");
  const headChars = Number(Deno.env.get("AI_EXTRACTIVE_HEAD_CHARS") ?? "2200");
  const tailChars = Number(Deno.env.get("AI_EXTRACTIVE_TAIL_CHARS") ?? "900");
  const parts: string[] = [];
  let total = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const trimmed = chunks[index].trim();
    let block: string;
    if (trimmed.length <= headChars + tailChars + 40) {
      block = `Section ${index + 1}:\n${trimmed}`;
    } else {
      block = `Section ${index + 1}:\n${trimmed.slice(0, headChars)}\n…\n${trimmed.slice(-tailChars)}`;
    }
    if (total + block.length > maxDigestChars) {
      parts.push(`[${chunks.length - index} more section(s) omitted — digest truncated]`);
      break;
    }
    parts.push(block);
    total += block.length;
  }

  return parts.join("\n\n");
}

async function summarizeChunksWithAi(
  chunks: string[],
  args: {
    baseUrl: string;
    apiKey: string;
    model: string;
    siteUrl?: string;
    appName: string;
  },
): Promise<string[]> {
  const maxAiChunks = Number(Deno.env.get("AI_MAX_CHUNK_SUMMARY_CALLS") ?? "3");
  if (chunks.length > maxAiChunks) {
    return [buildExtractiveChunkDigest(chunks)];
  }

  return Promise.all(
    chunks.map(async (chunk, index) => {
      const { content } = await callOpenRouter({
        ...args,
        messages: buildSummaryMessages(chunk, index),
      });
      return content;
    }),
  );
}

function buildProjectIdentityGuidance(project?: {
  projectName?: string | null;
  clientName?: string | null;
  projectType?: string | null;
}): string {
  const name = project?.projectName?.trim();
  const client = project?.clientName?.trim();
  const clientRef = client || name;
  const lines = [
    "Identity rules:",
    "OXUS is the agency/operator (always all caps, never 'Oxus'); OXUS Cloud is the PM platform.",
    "OXUS is NOT the client. The work is delivered FOR the client/project.",
  ];
  if (name) lines.push(`Project name: ${name}.`);
  if (client) lines.push(`Client: ${client}.`);
  lines.push(
    clientRef
      ? `Phrase memory, tasks, and summaries as helping ${clientRef}, not "helping OXUS", unless the client/project is OXUS.`
      : "Refer to \"the project\" or \"the client team\", not OXUS, unless the client/project is OXUS.",
  );
  return lines.join(" ");
}

function buildFinalMessages(
  sourceText: string,
  chunkSummaries: string[],
  existingProfile?: Record<string, unknown> | null,
  suppressedQuestions?: { question: string; status: string }[],
  clarificationContext?: string,
  projectIdentity?: { projectName?: string | null; clientName?: string | null; projectType?: string | null },
) {
  const sourceBlock = chunkSummaries.length > 0
    ? `Chunk summaries:\n${chunkSummaries.map((summary, index) => `Chunk ${index + 1}:\n${summary}`).join("\n\n")}`
    : `Source text:\n${sourceText}`;

  const existingBlock = existingProfile
    ? `\n\nExisting project memory (merge new facts — do not overwrite good memory with weaker text):\n${JSON.stringify({
      business_goal: existingProfile.business_goal,
      target_users: existingProfile.target_users,
      core_flows: existingProfile.core_flows,
      scope_in: existingProfile.scope_in,
      scope_out: existingProfile.scope_out,
      success_criteria: existingProfile.success_criteria,
      assumptions: existingProfile.assumptions,
      constraints: existingProfile.constraints,
      risks: existingProfile.risks,
      open_questions: existingProfile.open_questions,
      qa_strategy: existingProfile.qa_strategy,
      technical_notes: existingProfile.technical_notes,
      delivery_notes: existingProfile.delivery_notes,
      current_phase: existingProfile.current_phase,
    }, null, 2)}`
    : "";

  const suppressedBlock = suppressedQuestions && suppressedQuestions.length > 0
    ? `\n\nDo NOT repeat these previously skipped, cleared, or answered clarification questions unless new context makes them materially relevant:\n${
      suppressedQuestions.map((q) => `- [${q.status}] ${q.question}`).join("\n")
    }`
    : "";

  const clarificationBlock = clarificationContext
    ? `\n\nThis input is a PM answer to a prior clarification question. Incorporate it into memory and resolve related ambiguity:\n${clarificationContext}`
    : "";

  return [
    {
      role: "system" as const,
      content: [
        "You are an expert project manager for a web-development agency.",
        "Process a single memory intake — this is NOT a chat conversation.",
        "Classify the source type automatically.",
        "Merge new facts into existing project memory incrementally.",
        "Do not discard established memory unless the new source explicitly contradicts it.",
        "Propose implementation tasks ONLY when they are real delivery tasks with clear value.",
        "Do not invent scope or requirements.",
        "Ask clarification questions ONLY when truly needed (max 3, prefer 0).",
        "Good questions are specific and actionable. Bad questions are generic boilerplate.",
        "Do not repeat suppressed questions.",
        buildProjectIdentityGuidance(projectIdentity),
        "Output valid JSON only.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: `Return strict JSON with this shape:
{
  "detected_source_type": "meeting_transcript | slack_summary | client_feedback | project_description | requirements_doc | design_notes | qa_notes | technical_notes | delivery_update | uploaded_file | unknown",
  "memory_updates": {
    "business_goal": "string | null",
    "target_users": ["string"],
    "core_flows": ["string"],
    "success_criteria": ["string"],
    "scope_in": ["string"],
    "scope_out": ["string"],
    "risks": ["string"],
    "open_questions": ["string"],
    "delivery_notes": ["string"],
    "qa_strategy": "string | null"
  },
  "proposed_tasks": [
    {
      "title": "string",
      "description": "string",
      "priority": "low | medium | high | urgent",
      "acceptance_criteria": ["string"],
      "qa_scenarios": [
        {
          "title": "string",
          "steps": ["string"],
          "expected_result": "string",
          "priority": "low | medium | high"
        }
      ],
      "source_reason": "string"
    }
  ],
  "clarification_questions": [
    {
      "question": "string",
      "reason": "string",
      "importance": "low | medium | high",
      "blocks_task_creation": true
    }
  ],
  "summary": "string",
  "confidence": 0.0
}

Rules:
- Maximum 3 clarification_questions. Prefer zero.
- Only create proposed_tasks for real delivery work.
- Merge with existing memory; return only fields you can update from this source.
- For memory_updates arrays EXCEPT risks and open_questions: include only NEW or UPDATED items to merge.
- For memory_updates.risks and memory_updates.open_questions: ALWAYS return the COMPLETE refreshed lists reflecting existing memory plus this source. Remove items answered or resolved by new context. Dedupe similar wording. Do not repeat suppressed questions unless materially new context requires them.

${sourceBlock}${existingBlock}${suppressedBlock}${clarificationBlock}`,
    },
  ];
}

function mergeStringArrays(existing: string[], incoming: string[]): string[] {
  return mergeAppendStringArrays(existing, incoming);
}

function mergeOptionalText(existing: string | null | undefined, incoming: string | null): string | null {
  const next = incoming?.trim() ?? "";
  if (!next) return existing?.trim() || null;
  if (!existing?.trim()) return next;
  if (existing.trim().toLowerCase() === next.toLowerCase()) return existing.trim();
  if (existing.toLowerCase().includes(next.toLowerCase())) return existing.trim();
  if (next.toLowerCase().includes(existing.toLowerCase())) return next;
  return `${existing.trim()} ${next}`.slice(0, 4000);
}

function normalizeTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSummaryMessages(chunk: string, index: number) {
  return [
    {
      role: "system" as const,
      content: "Summarize this project-source chunk for later PM memory consolidation. Output JSON only.",
    },
    {
      role: "user" as const,
      content: `Return {"summary":"string","key_facts":["string"],"open_questions":["string"],"risks":["string"]}.

Chunk ${index + 1}:
${chunk}`,
    },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication is required to generate project memory.", 401, "AUTH_REQUIRED");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const supabaseKey = getPublishableKey();
    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Missing Supabase function environment.", 500, "CONFIG_ERROR");
    }

    const openRouterApiKey = requiredEnv("OPENROUTER_API_KEY");
    if (openRouterApiKey instanceof Response) return openRouterApiKey;
    const model = requiredEnv("OPENROUTER_DEFAULT_MODEL");
    if (model instanceof Response) return model;
    const configuredBaseUrl = Deno.env.get("OPENROUTER_BASE_URL")?.trim() || "https://openrouter.ai/api/v1";
    if (!configuredBaseUrl) return errorResponse("Missing required environment variable: OPENROUTER_BASE_URL.", 500, "CONFIG_ERROR");

    const maxInputChars = Number(Deno.env.get("AI_MAX_INPUT_CHARS") ?? "120000");
    const chunkSize = Number(Deno.env.get("AI_CHUNK_SIZE_CHARS") ?? "30000");
    if (!Number.isFinite(maxInputChars) || maxInputChars <= 0) {
      return errorResponse("AI_MAX_INPUT_CHARS must be a positive number.", 500, "CONFIG_ERROR");
    }
    if (!Number.isFinite(chunkSize) || chunkSize < 1000) {
      return errorResponse("AI_CHUNK_SIZE_CHARS must be at least 1000.", 500, "CONFIG_ERROR");
    }

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return errorResponse("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id;
    const requestedSourceType = body.source_type ?? "auto";
    const inputMethod = body.input_method ?? "text";
    const sourceText = (body.input_text ?? body.source_text ?? "").trim();
    const attentionItemId = typeof body.metadata?.attention_item_id === "string"
      ? body.metadata.attention_item_id
      : null;

    if (!projectId) return errorResponse("project_id is required.", 400, "INVALID_INPUT");
    if (!legacyKnowledgeSourceTypes.has(requestedSourceType)) {
      return errorResponse("Invalid source_type.", 400, "INVALID_INPUT");
    }
    if (!inputMethods.has(inputMethod)) return errorResponse("Invalid input_method.", 400, "INVALID_INPUT");
    if (!sourceText) return errorResponse("input_text or source_text is required.", 400, "INVALID_INPUT");
    const minChars = attentionItemId ? 5 : minSourceChars;
    if (sourceText.length < minChars) {
      return errorResponse(`Input must be at least ${minChars} characters.`, 400, "INVALID_INPUT");
    }
    if (sourceText.length > maxInputChars) {
      return errorResponse(
        `Input is ${sourceText.length} characters, above the configured ${maxInputChars} character limit.`,
        400,
        "INVALID_INPUT",
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) {
      return errorResponse("Authentication is required to generate project memory.", 401, "AUTH_REQUIRED");
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name, client_name, project_type")
      .eq("id", projectId)
      .single();
    if (projectError || !project) {
      return errorResponse("Project was not found or is not accessible.", 404, "PROJECT_NOT_FOUND", projectError?.message);
    }

    const { data: existingProfileRow } = await supabase
      .from("project_pm_profiles")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    const { data: suppressedRows } = await supabase
      .from("project_pm_attention_items")
      .select("question, status")
      .eq("project_id", projectId)
      .in("status", ["skipped", "cleared", "answered"]);

    let clarificationContext: string | undefined;
    if (attentionItemId) {
      const { data: attentionItem } = await supabase
        .from("project_pm_attention_items")
        .select("question, reason")
        .eq("id", attentionItemId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (attentionItem) {
        clarificationContext = `Question: ${attentionItem.question}\nReason: ${attentionItem.reason ?? ""}\nAnswer: ${sourceText}`;
      }
    }

    const chunks = chunkText(sourceText, chunkSize);
    if (chunks.length === 0) return errorResponse("Input did not produce any content chunks.", 400, "INVALID_INPUT");

    const appName = optionalEnv("OPENROUTER_APP_NAME") ?? "OXUS Cloud";
    const siteUrl = optionalEnv("OPENROUTER_SITE_URL");

    const chunkSummaryMode = (Deno.env.get("AI_CHUNK_SUMMARY_MODE") ?? "extractive").trim().toLowerCase();
    let finalSourceText = sourceText;
    let chunkSummaries: string[] = [];

    if (chunks.length > 1) {
      if (chunkSummaryMode === "ai") {
        try {
          chunkSummaries = await summarizeChunksWithAi(chunks, {
            baseUrl: configuredBaseUrl,
            apiKey: openRouterApiKey,
            model,
            siteUrl,
            appName,
          });
        } catch (error) {
          return errorResponse(
            "OpenRouter failed while summarizing source chunks.",
            502,
            "OPENROUTER_ERROR",
            (error as Error).message,
          );
        }
      } else {
        finalSourceText = buildExtractiveChunkDigest(chunks);
      }
    }

    let completion: unknown;
    let aiContent = "";
    try {
      const result = await callOpenRouter({
        baseUrl: configuredBaseUrl,
        apiKey: openRouterApiKey,
        model,
        siteUrl,
        appName,
        messages: buildFinalMessages(
          finalSourceText,
          chunkSummaries,
          existingProfileRow,
          suppressedRows ?? [],
          clarificationContext,
          {
            projectName: project.name ?? null,
            clientName: (project as { client_name?: string | null }).client_name ?? null,
            projectType: (project as { project_type?: string | null }).project_type ?? null,
          },
        ),
      });
      completion = result.completion;
      aiContent = result.content;
    } catch (error) {
      return errorResponse("OpenRouter API request failed.", 502, "OPENROUTER_ERROR", (error as Error).message);
    }

    let parsed: AiResponse;
    try {
      parsed = parseAiJson(aiContent);
    } catch (error) {
      console.error("[AI_PARSE_ERROR]", (error as Error).message, aiContent.slice(0, 1200));
      return errorResponse(
        "OpenRouter returned invalid JSON.",
        502,
        "AI_PARSE_ERROR",
        `${(error as Error).message}; response=${aiContent.slice(0, 1200)}`,
      );
    }

    const storedSourceType = resolveStoredSourceType(
      requestedSourceType,
      parsed.detected_source_type,
      inputMethod,
    );

    const { data: source, error: sourceError } = await supabase
      .from("project_knowledge_sources")
      .insert({
        project_id: projectId,
        source_type: storedSourceType,
        source_title: body.source_title?.trim() || body.file_name || null,
        input_method: inputMethod,
        file_name: body.file_name ?? null,
        mime_type: body.mime_type ?? null,
        char_count: sourceText.length,
        source_text: sourceText,
        source_preview: sourceText.slice(0, 1000),
        metadata: {
          ...(body.metadata ?? {}),
          detected_source_type: parsed.detected_source_type,
          processing_summary: parsed.summary,
          confidence: parsed.confidence,
        },
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (sourceError) {
      return errorResponse("Failed to store project knowledge source.", 500, "DB_ERROR", sourceError.message);
    }

    const chunkRows = chunks.map((content, index) => ({
      project_id: projectId,
      source_id: source.id,
      chunk_index: index,
      content,
      category: "source",
      metadata: { char_count: content.length },
    }));
    const { error: chunkError } = await supabase.from("project_knowledge_chunks").insert(chunkRows);
    if (chunkError) {
      return errorResponse("Failed to store project knowledge chunks.", 500, "DB_ERROR", chunkError.message);
    }

    const { data: brief, error: briefError } = await supabase
      .from("ai_project_briefs")
      .insert({
        project_id: projectId,
        source_type: briefSourceType(storedSourceType),
        source_text: sourceText,
        summary: parsed.summary || parsed.brief.summary,
        goals: parsed.brief.goals,
        scope_in: parsed.brief.scope_in,
        scope_out: parsed.brief.scope_out,
        risks: parsed.brief.risks,
        open_questions: parsed.brief.open_questions,
        qa_notes: parsed.brief.qa_notes,
        raw_response: completion,
        model,
        status: "completed",
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (briefError) return errorResponse("Failed to insert AI project brief.", 500, "DB_ERROR", briefError.message);

    const mem = parsed.memory_updates;
    const profile = parsed.project_profile;
    const suppressedKeys = buildSuppressedQuestionKeys(suppressedRows ?? []);

    const profileRow = {
      project_id: projectId,
      business_goal: mergeOptionalText(
        existingProfileRow?.business_goal as string | null,
        mem.business_goal ?? profile.business_goal,
      ),
      target_users: mergeStringArrays(
        asStringArray(existingProfileRow?.target_users),
        mem.target_users.length > 0 ? mem.target_users : profile.target_users,
      ),
      core_flows: mergeStringArrays(
        asStringArray(existingProfileRow?.core_flows),
        mem.core_flows.length > 0 ? mem.core_flows : profile.core_flows,
      ),
      scope_in: mergeStringArrays(
        asStringArray(existingProfileRow?.scope_in),
        mem.scope_in.length > 0 ? mem.scope_in : profile.scope_in,
      ),
      scope_out: mergeStringArrays(
        asStringArray(existingProfileRow?.scope_out),
        mem.scope_out.length > 0 ? mem.scope_out : profile.scope_out,
      ),
      success_criteria: mergeStringArrays(
        asStringArray(existingProfileRow?.success_criteria),
        mem.success_criteria.length > 0 ? mem.success_criteria : profile.success_criteria,
      ),
      assumptions: mergeStringArrays(
        asStringArray(existingProfileRow?.assumptions),
        profile.assumptions,
      ),
      constraints: mergeStringArrays(
        asStringArray(existingProfileRow?.constraints),
        profile.constraints,
      ),
      risks: mergeRefreshedStringArrays(
        asStringArray(existingProfileRow?.risks),
        mem.risks,
        suppressedKeys,
      ),
      open_questions: mergeRefreshedStringArrays(
        asStringArray(existingProfileRow?.open_questions),
        mem.open_questions,
        suppressedKeys,
      ),
      qa_strategy: mergeOptionalText(
        existingProfileRow?.qa_strategy as string | null,
        mem.qa_strategy ?? profile.qa_strategy,
      ),
      technical_notes: mergeStringArrays(
        asStringArray(existingProfileRow?.technical_notes),
        profile.technical_notes,
      ),
      delivery_notes: mergeStringArrays(
        asStringArray(existingProfileRow?.delivery_notes),
        mem.delivery_notes.length > 0 ? mem.delivery_notes : profile.delivery_notes,
      ),
      current_phase: mergeOptionalText(
        existingProfileRow?.current_phase as string | null,
        profile.current_phase,
      ),
      confidence: Math.max(
        clampConfidence(existingProfileRow?.confidence) ?? 0,
        parsed.confidence,
        profile.confidence,
      ),
      last_source_id: source.id,
      last_ai_brief_id: brief.id,
      raw_profile: parsed,
      created_by: auth.user.id,
    };

    const { data: profileData, error: profileError } = await supabase
      .from("project_pm_profiles")
      .upsert(profileRow, { onConflict: "project_id" })
      .select()
      .single();
    if (profileError) return errorResponse("Failed to upsert project PM profile.", 500, "DB_ERROR", profileError.message);

    let tasks: unknown[] = [];
    const taskCandidates = parsed.proposed_tasks.length > 0 ? parsed.proposed_tasks : parsed.tasks;
    if (taskCandidates.length > 0) {
      const { data: existingTasks } = await supabase
        .from("ai_proposed_tasks")
        .select("title")
        .eq("project_id", projectId);

      const existingTitles = new Set(
        (existingTasks ?? []).map((row: { title: string }) => normalizeTaskTitle(row.title)),
      );
      const newTasks = taskCandidates.filter((task) => !existingTitles.has(normalizeTaskTitle(task.title)));

      if (newTasks.length > 0) {
        const taskRows = newTasks.map((task) => ({
          project_id: projectId,
          brief_id: brief.id,
          source_knowledge_source_id: source.id,
          title: task.title,
          description: task.description || null,
          acceptance_criteria: task.acceptance_criteria,
          qa_scenarios: task.qa_scenarios,
          priority: task.priority,
          confidence: task.confidence,
          status: "pending",
          raw_item: task,
          created_by: auth.user.id,
        }));
        const { data, error } = await supabase.from("ai_proposed_tasks").insert(taskRows).select();
        if (error) return errorResponse("Failed to insert AI proposed tasks.", 500, "DB_ERROR", error.message);
        tasks = data ?? [];
      }
    }

    // Reconcile pre-existing open PM Attention questions against this new source,
    // BEFORE adding any new questions. Skipped for direct clarification answers.
    let reconciliation = null as Awaited<ReturnType<typeof reconcileProjectAttentionItems>> | null;
    if (!attentionItemId) {
      try {
        reconciliation = await reconcileProjectAttentionItems({
          admin: supabase,
          projectId,
          userId: auth.user.id,
          newContextText: [parsed.summary, sourceText].filter(Boolean).join("\n\n"),
          updatedMemory: profileData as Record<string, unknown> | null,
          sourceIds: [source.id],
          sourceType: storedSourceType,
          sourceTitle: body.source_title?.trim() || body.file_name || null,
          projectName: project.name ?? null,
          clientName: (project as { client_name?: string | null }).client_name ?? null,
        });
      } catch (e) {
        console.warn("[generate-project-brief] attention reconciliation failed:", (e as Error).message);
      }
    }

    const suppressedQuestionKeys = new Set(
      (suppressedRows ?? []).map((row) => normalizeQuestionKey(row.question)),
    );
    const openKeys = new Set<string>();
    const { data: openRows } = await supabase
      .from("project_pm_attention_items")
      .select("question_key")
      .eq("project_id", projectId)
      .eq("status", "open");
    for (const row of openRows ?? []) {
      if (row.question_key) openKeys.add(row.question_key);
    }

    const newQuestions = parsed.clarification_questions.filter((q) => {
      const key = normalizeQuestionKey(q.question);
      return !suppressedQuestionKeys.has(key) && !openKeys.has(key);
    });

    let attentionItems: unknown[] = [];
    if (newQuestions.length > 0) {
      const attentionRows = newQuestions.map((q) => ({
        project_id: projectId,
        question: q.question,
        reason: q.reason || null,
        importance: q.importance,
        blocks_task_creation: q.blocks_task_creation,
        status: "open",
        source_memory_run_id: brief.id,
        source_knowledge_source_id: source.id,
        question_key: normalizeQuestionKey(q.question),
        created_by: auth.user.id,
        metadata: { detected_source_type: parsed.detected_source_type },
      }));
      const { data, error } = await supabase
        .from("project_pm_attention_items")
        .insert(attentionRows)
        .select();
      if (error) return errorResponse("Failed to insert PM attention items.", 500, "DB_ERROR", error.message);
      attentionItems = data ?? [];
    }

    if (attentionItemId) {
      await supabase
        .from("project_pm_attention_items")
        .update({
          status: "answered",
          answer_text: sourceText,
          answered_at: new Date().toISOString(),
        })
        .eq("id", attentionItemId)
        .eq("project_id", projectId);
    }

    return jsonResponse({
      source,
      profile: profileData,
      brief,
      tasks,
      attention_items: attentionItems,
      attention_reconciliation: reconciliation,
      detected_source_type: parsed.detected_source_type,
      summary: parsed.summary,
      confidence: parsed.confidence,
    });
  } catch (error) {
    console.error("[UNEXPECTED_ERROR]", (error as Error).message);
    return errorResponse("Failed to generate project memory.", 500, "UNEXPECTED_ERROR", (error as Error).message);
  }
});
