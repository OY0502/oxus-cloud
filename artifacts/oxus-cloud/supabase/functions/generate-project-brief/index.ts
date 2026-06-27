import { createClient } from "npm:@supabase/supabase-js@2";

type SourceType = "manual" | "zoom_transcript" | "project_description" | "other";
type Priority = "low" | "medium" | "high" | "urgent";

type RequestBody = {
  project_id?: string;
  source_type?: SourceType;
  source_text?: string;
};

type AiQaScenario = {
  title: string;
  steps: string[];
  expected_result: string;
  priority: "low" | "medium" | "high";
};

type AiTask = {
  title: string;
  description: string;
  acceptance_criteria: string[];
  qa_scenarios: AiQaScenario[];
  priority: Priority;
  confidence: number;
};

type AiBriefResponse = {
  summary: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  risks: string[];
  open_questions: string[];
  qa_notes: string[];
  tasks: AiTask[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sourceTypes = new Set<SourceType>(["manual", "zoom_transcript", "project_description", "other"]);
const priorities = new Set<Priority>(["low", "medium", "high", "urgent"]);
const qaPriorities = new Set(["low", "medium", "high"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function asQaScenarios(value: unknown): AiQaScenario[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      steps: asStringArray(item.steps),
      expected_result: typeof item.expected_result === "string" ? item.expected_result.trim() : "",
      priority: qaPriorities.has(String(item.priority)) ? (item.priority as AiQaScenario["priority"]) : "medium",
    }))
    .filter((item) => item.title);
}

function parseAiJson(content: string): AiBriefResponse {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    goals: asStringArray(parsed.goals),
    scope_in: asStringArray(parsed.scope_in),
    scope_out: asStringArray(parsed.scope_out),
    risks: asStringArray(parsed.risks),
    open_questions: asStringArray(parsed.open_questions),
    qa_notes: asStringArray(parsed.qa_notes),
    tasks: tasks
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title.trim() : "",
        description: typeof item.description === "string" ? item.description.trim() : "",
        acceptance_criteria: asStringArray(item.acceptance_criteria),
        qa_scenarios: asQaScenarios(item.qa_scenarios),
        priority: priorities.has(String(item.priority)) ? (item.priority as Priority) : "medium",
        confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0,
      }))
      .filter((item) => item.title),
  };
}

function buildMessages(sourceText: string) {
  return [
    {
      role: "system",
      content: [
        "You are an expert project manager for a web-development agency.",
        "Convert raw project notes, client descriptions, and meeting transcripts into a clean implementation brief.",
        "Focus on practical tasks for developers and QA.",
        "Do not invent features that are not implied by the input.",
        "Mark uncertainties as open questions.",
        "Each task must be actionable.",
        "Each task should include QA scenarios where relevant.",
        "Output only valid JSON matching the requested schema.",
      ].join(" "),
    },
    {
      role: "user",
      content: `Return strict JSON with this shape:
{
  "summary": "string",
  "goals": ["string"],
  "scope_in": ["string"],
  "scope_out": ["string"],
  "risks": ["string"],
  "open_questions": ["string"],
  "qa_notes": ["string"],
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "acceptance_criteria": ["string"],
      "qa_scenarios": [
        {
          "title": "string",
          "steps": ["string"],
          "expected_result": "string",
          "priority": "low | medium | high"
        }
      ],
      "priority": "low | medium | high | urgent",
      "confidence": 0.0
    }
  ]
}

Source notes:
${sourceText}`,
    },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthenticated request." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = getPublishableKey();
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: "Missing Supabase function environment." }, 500);
    }

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    const model = Deno.env.get("OPENROUTER_DEFAULT_MODEL");
    if (!openRouterApiKey) return jsonResponse({ error: "Missing OPENROUTER_API_KEY." }, 500);
    if (!model) return jsonResponse({ error: "Missing OPENROUTER_DEFAULT_MODEL." }, 500);

    const maxInputChars = Number(Deno.env.get("AI_MAX_INPUT_CHARS") ?? "50000");
    const body = (await req.json()) as RequestBody;
    const projectId = body.project_id;
    const sourceType = body.source_type ?? "manual";
    const sourceText = body.source_text?.trim() ?? "";

    if (!projectId) return jsonResponse({ error: "project_id is required." }, 400);
    if (!sourceTypes.has(sourceType)) return jsonResponse({ error: "Invalid source_type." }, 400);
    if (!sourceText) return jsonResponse({ error: "source_text is required." }, 400);
    if (sourceText.length > maxInputChars) {
      return jsonResponse({ error: `source_text must be ${maxInputChars} characters or fewer.` }, 413);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: auth, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !auth.user) return jsonResponse({ error: "Unauthenticated request." }, 401);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();
    if (projectError || !project) {
      return jsonResponse({ error: projectError?.message ?? "Project not found or not accessible." }, 404);
    }

    const baseUrl = (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const openRouterResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
        ...(Deno.env.get("OPENROUTER_SITE_URL") ? { "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL")! } : {}),
        ...(Deno.env.get("OPENROUTER_APP_NAME") ? { "X-Title": Deno.env.get("OPENROUTER_APP_NAME")! } : {}),
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(sourceText),
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!openRouterResponse.ok) {
      const detail = (await openRouterResponse.text()).slice(0, 1000);
      return jsonResponse({ error: "OpenRouter API request failed.", detail }, 502);
    }

    const completion = await openRouterResponse.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return jsonResponse({ error: "OpenRouter returned an empty response." }, 502);
    }

    let parsed: AiBriefResponse;
    try {
      parsed = parseAiJson(content);
    } catch (error) {
      return jsonResponse({ error: "OpenRouter returned invalid JSON.", detail: (error as Error).message }, 502);
    }

    const { data: brief, error: briefError } = await supabase
      .from("ai_project_briefs")
      .insert({
        project_id: projectId,
        source_type: sourceType,
        source_text: sourceText,
        summary: parsed.summary,
        goals: parsed.goals,
        scope_in: parsed.scope_in,
        scope_out: parsed.scope_out,
        risks: parsed.risks,
        open_questions: parsed.open_questions,
        qa_notes: parsed.qa_notes,
        raw_response: completion,
        model,
        status: "completed",
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (briefError) return jsonResponse({ error: "Failed to insert AI project brief.", detail: briefError.message }, 500);

    let tasks: unknown[] = [];
    if (parsed.tasks.length > 0) {
      const rows = parsed.tasks.map((task) => ({
        project_id: projectId,
        brief_id: brief.id,
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
      const { data, error } = await supabase.from("ai_proposed_tasks").insert(rows).select();
      if (error) return jsonResponse({ error: "Failed to insert AI proposed tasks.", detail: error.message }, 500);
      tasks = data ?? [];
    }

    return jsonResponse({ brief, tasks });
  } catch (error) {
    return jsonResponse({ error: "Failed to generate AI project brief.", detail: (error as Error).message }, 500);
  }
});
