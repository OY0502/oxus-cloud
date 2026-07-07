import { createClient } from "npm:@supabase/supabase-js@2";

type Priority = "low" | "medium" | "high" | "urgent";
type QaPriority = "low" | "medium" | "high";

type RequestBody = {
  project_id?: string;
  figma_url?: string;
  source_title?: string;
};

type ErrorCode =
  | "AUTH_REQUIRED"
  | "CONFIG_ERROR"
  | "INVALID_INPUT"
  | "PROJECT_NOT_FOUND"
  | "FIGMA_ERROR"
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
  implementation_notes: string[];
  design_notes: string[];
  estimate_hours: number | null;
  priority: Priority;
  figma_node_ids: string[];
  design_url: string | null;
  confidence: number;
};

type ProfilePatch = {
  business_goal: string | null;
  target_users: string[];
  core_flows: string[];
  scope_in: string[];
  scope_out: string[];
  success_criteria: string[];
  assumptions: string[];
  constraints: string[];
  risks: string[];
  open_questions: string[];
  qa_strategy: string | null;
  technical_notes: string[];
  delivery_notes: string[];
  current_phase: string | null;
  confidence: number;
};

type FigmaSummary = {
  summary: string;
  screens: string[];
  flows: string[];
  components: string[];
  design_notes: string[];
  implementation_notes: string[];
  open_questions: string[];
};

type AiResponse = {
  project_profile_patch: ProfilePatch;
  figma_summary: FigmaSummary;
  tasks: AiTask[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const priorities = new Set<Priority>(["low", "medium", "high", "urgent"]);
const qaPriorities = new Set<QaPriority>(["low", "medium", "high"]);

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

function uniqueMerge(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...existing, ...incoming]) {
    const key = item.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

// Supports figma.com/file/<key>/... and figma.com/design/<key>/..., with optional node-id.
function parseFigmaUrl(rawUrl: string): { fileKey: string; nodeId: string | null } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/figma\.com$/i.test(url.hostname) && !/\.figma\.com$/i.test(url.hostname)) return null;

  const match = url.pathname.match(/\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const fileKey = match[1];

  let nodeId = url.searchParams.get("node-id");
  if (nodeId) {
    // Figma URL node ids use "-" but the API expects ":".
    nodeId = decodeURIComponent(nodeId).replace(/-/g, ":");
  }
  return { fileKey, nodeId: nodeId || null };
}

function collectFromNode(
  node: any,
  limits: { maxNodes: number; maxTextChars: number },
  acc: { frames: string[]; texts: string[]; nodeCount: number; textChars: number },
) {
  if (!node || acc.nodeCount >= limits.maxNodes) return;
  acc.nodeCount += 1;

  if ((node.type === "FRAME" || node.type === "COMPONENT" || node.type === "SECTION") && typeof node.name === "string") {
    if (acc.frames.length < 200) acc.frames.push(node.name);
  }
  if (node.type === "TEXT" && typeof node.characters === "string") {
    const text = node.characters.trim();
    if (text && acc.textChars < limits.maxTextChars) {
      const slice = text.slice(0, Math.max(0, limits.maxTextChars - acc.textChars));
      acc.texts.push(slice);
      acc.textChars += slice.length;
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (acc.nodeCount >= limits.maxNodes) break;
      collectFromNode(child, limits, acc);
    }
  }
}

function buildCompactContext(
  fileName: string,
  document: any,
  components: Record<string, any> | undefined,
  selectedNode: any,
  limits: { maxNodes: number; maxTextChars: number },
): string {
  const pages: string[] = [];
  const topFrames: string[] = [];
  const acc = { frames: [] as string[], texts: [] as string[], nodeCount: 0, textChars: 0 };

  const canvases = Array.isArray(document?.children) ? document.children : [];
  for (const canvas of canvases) {
    if (typeof canvas?.name === "string") pages.push(canvas.name);
    if (Array.isArray(canvas?.children)) {
      for (const frame of canvas.children) {
        if (typeof frame?.name === "string" && topFrames.length < 100) topFrames.push(frame.name);
      }
    }
  }

  const traversalRoot = selectedNode ?? document;
  collectFromNode(traversalRoot, limits, acc);

  const componentNames = components
    ? Object.values(components)
        .map((c: any) => (typeof c?.name === "string" ? c.name : null))
        .filter((name): name is string => Boolean(name))
        .slice(0, 100)
    : [];

  const sections = [
    `File name: ${fileName}`,
    pages.length ? `Pages: ${pages.join(", ")}` : "",
    topFrames.length ? `Top-level frames: ${topFrames.join(", ")}` : "",
    acc.frames.length ? `Frames/components seen: ${Array.from(new Set(acc.frames)).slice(0, 150).join(", ")}` : "",
    componentNames.length ? `Component library: ${componentNames.join(", ")}` : "",
    acc.texts.length ? `Visible text content:\n${acc.texts.join("\n")}` : "",
  ].filter(Boolean);

  return sections.join("\n\n").slice(0, limits.maxTextChars + 8000);
}

function extractJson(content: string) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return unfenced;
  return unfenced.slice(start, end + 1);
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

function parseAiJson(content: string): AiResponse {
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  const patch = (parsed.project_profile_patch ?? {}) as Record<string, unknown>;
  const summary = (parsed.figma_summary ?? {}) as Record<string, unknown>;
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  return {
    project_profile_patch: {
      business_goal: typeof patch.business_goal === "string" && patch.business_goal.trim() ? patch.business_goal.trim() : null,
      target_users: asStringArray(patch.target_users),
      core_flows: asStringArray(patch.core_flows),
      scope_in: asStringArray(patch.scope_in),
      scope_out: asStringArray(patch.scope_out),
      success_criteria: asStringArray(patch.success_criteria),
      assumptions: asStringArray(patch.assumptions),
      constraints: asStringArray(patch.constraints),
      risks: asStringArray(patch.risks),
      open_questions: asStringArray(patch.open_questions),
      qa_strategy: typeof patch.qa_strategy === "string" && patch.qa_strategy.trim() ? patch.qa_strategy.trim() : null,
      technical_notes: asStringArray(patch.technical_notes),
      delivery_notes: asStringArray(patch.delivery_notes),
      current_phase: typeof patch.current_phase === "string" && patch.current_phase.trim() ? patch.current_phase.trim() : null,
      confidence: clampConfidence(patch.confidence) ?? 0,
    },
    figma_summary: {
      summary: typeof summary.summary === "string" ? summary.summary.trim() : "",
      screens: asStringArray(summary.screens),
      flows: asStringArray(summary.flows),
      components: asStringArray(summary.components),
      design_notes: asStringArray(summary.design_notes),
      implementation_notes: asStringArray(summary.implementation_notes),
      open_questions: asStringArray(summary.open_questions),
    },
    tasks: tasks
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title.trim() : "",
        description: typeof item.description === "string" ? item.description.trim() : "",
        acceptance_criteria: asStringArray(item.acceptance_criteria),
        qa_scenarios: asQaScenarios(item.qa_scenarios),
        implementation_notes: asStringArray(item.implementation_notes),
        design_notes: asStringArray(item.design_notes),
        estimate_hours: typeof item.estimate_hours === "number" && item.estimate_hours >= 0 ? item.estimate_hours : null,
        priority: priorities.has(item.priority as Priority) ? (item.priority as Priority) : "medium",
        figma_node_ids: asStringArray(item.figma_node_ids),
        design_url: typeof item.design_url === "string" && item.design_url.trim() ? item.design_url.trim() : null,
        confidence: clampConfidence(item.confidence) ?? 0,
      }))
      .filter((item) => item.title),
  };
}

function buildMessages(designContext: string) {
  return [
    {
      role: "system" as const,
      content: [
        "You are an expert PM and senior web app developer.",
        "Analyze Figma design context for implementation planning.",
        "Extract real UI screens, flows, components, and missing requirements.",
        "Do not invent backend behavior that is not implied.",
        "If design is unclear, create open questions.",
        "Create tasks that are useful for developers and QA.",
        "Include QA scenarios based on visible screens/flows.",
        "Include implementation notes where relevant.",
        "Output valid JSON only.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: `Return strict JSON with this shape:
{
  "project_profile_patch": {
    "business_goal": "string | null",
    "target_users": ["string"],
    "core_flows": ["string"],
    "scope_in": ["string"],
    "scope_out": ["string"],
    "success_criteria": ["string"],
    "assumptions": ["string"],
    "constraints": ["string"],
    "risks": ["string"],
    "open_questions": ["string"],
    "qa_strategy": "string | null",
    "technical_notes": ["string"],
    "delivery_notes": ["string"],
    "current_phase": "string | null",
    "confidence": 0.0
  },
  "figma_summary": {
    "summary": "string",
    "screens": ["string"],
    "flows": ["string"],
    "components": ["string"],
    "design_notes": ["string"],
    "implementation_notes": ["string"],
    "open_questions": ["string"]
  },
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "acceptance_criteria": ["string"],
      "qa_scenarios": [
        { "title": "string", "steps": ["string"], "expected_result": "string", "priority": "low | medium | high" }
      ],
      "implementation_notes": ["string"],
      "design_notes": ["string"],
      "estimate_hours": 0,
      "priority": "low | medium | high | urgent",
      "figma_node_ids": ["string"],
      "design_url": "string | null",
      "confidence": 0.0
    }
  ]
}

Figma design context:
${designContext}`,
    },
  ];
}

async function callOpenRouter(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  siteUrl?: string;
  appName: string;
  messages: { role: "system" | "user"; content: string }[];
}) {
  const response = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      ...(args.siteUrl ? { "HTTP-Referer": args.siteUrl } : {}),
      "X-Title": args.appName,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`model=${args.model}; status=${response.status}; response=${responseText.slice(0, 1200)}`);
  }
  let completion: any;
  try {
    completion = JSON.parse(responseText);
  } catch {
    throw new Error(`model=${args.model}; status=${response.status}; non-JSON wrapper=${responseText.slice(0, 1200)}`);
  }
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`model=${args.model}; status=${response.status}; empty message content`);
  }
  return { completion, content };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication is required to import Figma context.", 401, "AUTH_REQUIRED");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const supabaseKey = getPublishableKey();
    if (!supabaseUrl || !supabaseKey) return errorResponse("Missing Supabase function environment.", 500, "CONFIG_ERROR");

    const figmaToken = optionalEnv("FIGMA_ACCESS_TOKEN");
    if (!figmaToken) return errorResponse("Missing required environment variable: FIGMA_ACCESS_TOKEN.", 500, "CONFIG_ERROR");
    const figmaBaseUrl = (optionalEnv("FIGMA_API_BASE_URL") ?? "https://api.figma.com").replace(/\/+$/, "");
    const maxNodes = Number(Deno.env.get("FIGMA_MAX_NODES") ?? "300");
    const maxTextChars = Number(Deno.env.get("FIGMA_MAX_TEXT_CHARS") ?? "60000");

    const openRouterApiKey = optionalEnv("OPENROUTER_API_KEY");
    const model = optionalEnv("OPENROUTER_DEFAULT_MODEL");
    if (!openRouterApiKey) return errorResponse("Missing required environment variable: OPENROUTER_API_KEY.", 500, "CONFIG_ERROR");
    if (!model) return errorResponse("Missing required environment variable: OPENROUTER_DEFAULT_MODEL.", 500, "CONFIG_ERROR");
    const openRouterBaseUrl = optionalEnv("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
    const appName = optionalEnv("OPENROUTER_APP_NAME") ?? "OXUS Cloud";
    const siteUrl = optionalEnv("OPENROUTER_SITE_URL");

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return errorResponse("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id;
    const figmaUrl = body.figma_url?.trim() ?? "";
    if (!projectId) return errorResponse("project_id is required.", 400, "INVALID_INPUT");
    if (!figmaUrl) return errorResponse("figma_url is required.", 400, "INVALID_INPUT");

    const parsed = parseFigmaUrl(figmaUrl);
    if (!parsed) {
      return errorResponse("Could not parse a Figma file key from the provided URL.", 400, "INVALID_INPUT");
    }
    const { fileKey, nodeId } = parsed;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return errorResponse("Authentication is required to import Figma context.", 401, "AUTH_REQUIRED");

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();
    if (projectError || !project) {
      return errorResponse("Project was not found or is not accessible.", 404, "PROJECT_NOT_FOUND", projectError?.message);
    }

    // Upsert the Figma reference up front so we can record errors against it.
    const { data: reference, error: refError } = await supabase
      .from("project_figma_references")
      .upsert(
        {
          project_id: projectId,
          figma_url: figmaUrl,
          file_key: fileKey,
          node_id: nodeId,
          title: body.source_title?.trim() || null,
          metadata: { figma_url: figmaUrl, file_key: fileKey, node_id: nodeId },
          created_by: auth.user.id,
        },
        { onConflict: "project_id,file_key" },
      )
      .select()
      .maybeSingle();
    // onConflict may not have a unique constraint; fall back to plain insert if needed.
    let figmaReference = reference;
    if (refError || !figmaReference) {
      const { data: inserted, error: insertError } = await supabase
        .from("project_figma_references")
        .insert({
          project_id: projectId,
          figma_url: figmaUrl,
          file_key: fileKey,
          node_id: nodeId,
          title: body.source_title?.trim() || null,
          metadata: { figma_url: figmaUrl, file_key: fileKey, node_id: nodeId },
          created_by: auth.user.id,
        })
        .select()
        .single();
      if (insertError) return errorResponse("Failed to store Figma reference.", 500, "DB_ERROR", insertError.message);
      figmaReference = inserted;
    }

    const recordFigmaError = async (message: string) => {
      await supabase
        .from("project_figma_references")
        .update({ last_error: message.slice(0, 1000) })
        .eq("id", figmaReference!.id);
    };

    // Fetch Figma file (shallow) plus optional selected node subtree.
    let fileData: any;
    try {
      const fileUrl = `${figmaBaseUrl}/v1/files/${fileKey}?depth=2`;
      const fileResponse = await fetch(fileUrl, { headers: { "X-Figma-Token": figmaToken } });
      const fileText = await fileResponse.text();
      if (!fileResponse.ok) {
        throw new Error(`status=${fileResponse.status}; response=${fileText.slice(0, 800)}`);
      }
      fileData = JSON.parse(fileText);
    } catch (error) {
      await recordFigmaError((error as Error).message);
      return errorResponse("Failed to fetch the Figma file.", 502, "FIGMA_ERROR", (error as Error).message);
    }

    let selectedNode: any = null;
    if (nodeId) {
      try {
        const nodeUrl = `${figmaBaseUrl}/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=6`;
        const nodeResponse = await fetch(nodeUrl, { headers: { "X-Figma-Token": figmaToken } });
        if (nodeResponse.ok) {
          const nodeJson = await nodeResponse.json();
          selectedNode = nodeJson?.nodes?.[nodeId]?.document ?? null;
        }
      } catch (_error) {
        // Non-fatal: fall back to file-level context.
        selectedNode = null;
      }
    }

    const designContext = buildCompactContext(
      typeof fileData?.name === "string" ? fileData.name : "Figma file",
      fileData?.document,
      fileData?.components,
      selectedNode,
      { maxNodes: Number.isFinite(maxNodes) ? maxNodes : 300, maxTextChars: Number.isFinite(maxTextChars) ? maxTextChars : 60000 },
    );

    if (!designContext.trim()) {
      await recordFigmaError("No usable design context could be extracted.");
      return errorResponse("No usable design context could be extracted from this Figma file.", 422, "FIGMA_ERROR");
    }

    const sourceTitle = body.source_title?.trim() || (typeof fileData?.name === "string" ? fileData.name : "Figma import");

    const { data: source, error: sourceError } = await supabase
      .from("project_knowledge_sources")
      .insert({
        project_id: projectId,
        source_type: "figma",
        source_title: sourceTitle,
        input_method: "api",
        external_provider: "figma",
        external_id: fileKey,
        char_count: designContext.length,
        source_text: designContext,
        source_preview: designContext.slice(0, 1000),
        metadata: { file_key: fileKey, node_id: nodeId, figma_url: figmaUrl },
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (sourceError) {
      await recordFigmaError(sourceError.message);
      return errorResponse("Failed to store Figma knowledge source.", 500, "DB_ERROR", sourceError.message);
    }

    const chunkSize = 10000;
    const chunkRows: { project_id: string; source_id: string; chunk_index: number; content: string; category: string; metadata: Record<string, unknown> }[] = [];
    for (let start = 0, index = 0; start < designContext.length; start += chunkSize, index += 1) {
      chunkRows.push({
        project_id: projectId,
        source_id: source.id,
        chunk_index: index,
        content: designContext.slice(start, start + chunkSize),
        category: "figma",
        metadata: { file_key: fileKey, node_id: nodeId },
      });
    }
    if (chunkRows.length > 0) {
      const { error: chunkError } = await supabase.from("project_knowledge_chunks").insert(chunkRows);
      if (chunkError) {
        await recordFigmaError(chunkError.message);
        return errorResponse("Failed to store Figma knowledge chunks.", 500, "DB_ERROR", chunkError.message);
      }
    }

    let completion: unknown;
    let aiContent = "";
    try {
      const result = await callOpenRouter({
        baseUrl: openRouterBaseUrl,
        apiKey: openRouterApiKey,
        model,
        siteUrl,
        appName,
        messages: buildMessages(designContext),
      });
      completion = result.completion;
      aiContent = result.content;
    } catch (error) {
      await recordFigmaError((error as Error).message);
      return errorResponse("OpenRouter request failed while analyzing Figma context.", 502, "OPENROUTER_ERROR", (error as Error).message);
    }

    let analysis: AiResponse;
    try {
      analysis = parseAiJson(aiContent);
    } catch (error) {
      await recordFigmaError("AI returned invalid JSON.");
      return errorResponse(
        "OpenRouter returned invalid JSON.",
        502,
        "AI_PARSE_ERROR",
        `${(error as Error).message}; response=${aiContent.slice(0, 1200)}`,
      );
    }

    // Part 7: merge profile patch safely with existing profile.
    const { data: existingProfile } = await supabase
      .from("project_pm_profiles")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    const patch = analysis.project_profile_patch;
    const designNotes = analysis.figma_summary.design_notes;
    const implementationNotes = analysis.figma_summary.implementation_notes;

    const mergedProfile = {
      project_id: projectId,
      business_goal: patch.business_goal || existingProfile?.business_goal || null,
      target_users: uniqueMerge(existingProfile?.target_users ?? [], patch.target_users),
      core_flows: uniqueMerge(existingProfile?.core_flows ?? [], patch.core_flows),
      scope_in: uniqueMerge(existingProfile?.scope_in ?? [], patch.scope_in),
      scope_out: uniqueMerge(existingProfile?.scope_out ?? [], patch.scope_out),
      success_criteria: uniqueMerge(existingProfile?.success_criteria ?? [], patch.success_criteria),
      assumptions: uniqueMerge(existingProfile?.assumptions ?? [], patch.assumptions),
      constraints: uniqueMerge(existingProfile?.constraints ?? [], patch.constraints),
      risks: uniqueMerge(existingProfile?.risks ?? [], patch.risks),
      open_questions: uniqueMerge(
        existingProfile?.open_questions ?? [],
        uniqueMerge(patch.open_questions, analysis.figma_summary.open_questions),
      ),
      qa_strategy: patch.qa_strategy || existingProfile?.qa_strategy || null,
      technical_notes: uniqueMerge(existingProfile?.technical_notes ?? [], uniqueMerge(patch.technical_notes, implementationNotes)),
      delivery_notes: uniqueMerge(existingProfile?.delivery_notes ?? [], uniqueMerge(patch.delivery_notes, designNotes)),
      current_phase: patch.current_phase || existingProfile?.current_phase || null,
      confidence: patch.confidence || existingProfile?.confidence || null,
      last_source_id: source.id,
      raw_profile: { ...(existingProfile?.raw_profile ?? {}), figma_patch: patch, figma_summary: analysis.figma_summary },
      created_by: existingProfile?.created_by ?? auth.user.id,
    };

    const { data: profile, error: profileError } = await supabase
      .from("project_pm_profiles")
      .upsert(mergedProfile, { onConflict: "project_id" })
      .select()
      .single();
    if (profileError) {
      await recordFigmaError(profileError.message);
      return errorResponse("Failed to update project PM profile.", 500, "DB_ERROR", profileError.message);
    }

    // Part 8: design-aware proposed tasks.
    let tasks: unknown[] = [];
    if (analysis.tasks.length > 0) {
      const taskRows = analysis.tasks.map((task) => ({
        project_id: projectId,
        title: task.title,
        description: task.description || null,
        acceptance_criteria: task.acceptance_criteria,
        qa_scenarios: task.qa_scenarios,
        implementation_notes: task.implementation_notes,
        design_notes: task.design_notes,
        estimate_hours: task.estimate_hours,
        priority: task.priority,
        confidence: task.confidence,
        status: "pending",
        source_knowledge_source_id: source.id,
        figma_file_key: fileKey,
        figma_node_ids: task.figma_node_ids.length ? task.figma_node_ids : (nodeId ? [nodeId] : []),
        design_url: task.design_url || figmaUrl,
        raw_item: task,
        created_by: auth.user.id,
      }));
      const { data, error } = await supabase.from("ai_proposed_tasks").insert(taskRows).select();
      if (error) {
        await recordFigmaError(error.message);
        return errorResponse("Failed to insert Figma proposed tasks.", 500, "DB_ERROR", error.message);
      }
      tasks = data ?? [];
    }

    const { data: updatedReference } = await supabase
      .from("project_figma_references")
      .update({
        title: sourceTitle,
        description: analysis.figma_summary.summary || null,
        last_imported_at: new Date().toISOString(),
        last_error: null,
        metadata: { file_key: fileKey, node_id: nodeId, figma_url: figmaUrl, source_id: source.id },
      })
      .eq("id", figmaReference!.id)
      .select()
      .maybeSingle();

    return jsonResponse({
      reference: updatedReference ?? figmaReference,
      source,
      profile,
      figma_summary: analysis.figma_summary,
      tasks,
    });
  } catch (error) {
    console.error("[UNEXPECTED_ERROR]", (error as Error).message);
    return errorResponse("Failed to import Figma context.", 500, "UNEXPECTED_ERROR", (error as Error).message);
  }
});
