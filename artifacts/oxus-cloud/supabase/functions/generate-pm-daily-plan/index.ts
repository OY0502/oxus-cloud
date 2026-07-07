import { createClient } from "npm:@supabase/supabase-js@2";

type Urgency = "low" | "medium" | "high" | "urgent";

type RequestBody = {
  date?: string;
};

type ErrorCode =
  | "AUTH_REQUIRED"
  | "CONFIG_ERROR"
  | "INVALID_INPUT"
  | "DB_ERROR"
  | "OPENROUTER_ERROR"
  | "AI_PARSE_ERROR"
  | "UNEXPECTED_ERROR";

type AiDailyPlan = {
  summary: string;
  top_priorities: string[];
  project_focus: Array<{
    project_id: string;
    project_name: string;
    reason: string;
    recommended_action: string;
    urgency: Urgency;
  }>;
  risks: string[];
  suggested_order: string[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const urgencyValues = new Set<Urgency>(["low", "medium", "high", "urgent"]);

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

function extractJson(content: string) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return unfenced;
  return unfenced.slice(start, end + 1);
}

function isOpenPmAction(item: Record<string, unknown>): boolean {
  const status = item.status;
  if (status === "dismissed" || status === "done") return false;
  const executionStatus = item.execution_status;
  if (executionStatus === "succeeded" || executionStatus === "skipped") return false;
  if (item.resolution_source === "clickup_signal" || item.auto_resolved_reason) return false;
  return status === "open" || status === "in_progress";
}

function parseAiJson(content: string): AiDailyPlan {
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  const focusRaw = Array.isArray(parsed.project_focus) ? parsed.project_focus : [];
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    top_priorities: asStringArray(parsed.top_priorities),
    project_focus: focusRaw
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .map((item) => ({
        project_id: typeof item.project_id === "string" ? item.project_id.trim() : "",
        project_name: typeof item.project_name === "string" ? item.project_name.trim() : "",
        reason: typeof item.reason === "string" ? item.reason.trim() : "",
        recommended_action: typeof item.recommended_action === "string" ? item.recommended_action.trim() : "",
        urgency: urgencyValues.has(item.urgency as Urgency) ? (item.urgency as Urgency) : "medium",
      }))
      .filter((item) => item.project_name || item.reason),
    risks: asStringArray(parsed.risks),
    suggested_order: asStringArray(parsed.suggested_order),
  };
}

function compactJson(value: unknown, max = 2000): string {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
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
  const completion = JSON.parse(responseText);
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
      return errorResponse("Authentication is required to generate a PM daily plan.", 401, "AUTH_REQUIRED");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const supabaseKey = getPublishableKey();
    if (!supabaseUrl || !supabaseKey) return errorResponse("Missing Supabase function environment.", 500, "CONFIG_ERROR");

    const openRouterApiKey = optionalEnv("OPENROUTER_API_KEY");
    const model = optionalEnv("OPENROUTER_DEFAULT_MODEL");
    if (!openRouterApiKey) return errorResponse("Missing required environment variable: OPENROUTER_API_KEY.", 500, "CONFIG_ERROR");
    if (!model) return errorResponse("Missing required environment variable: OPENROUTER_DEFAULT_MODEL.", 500, "CONFIG_ERROR");
    const openRouterBaseUrl = optionalEnv("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
    const appName = optionalEnv("OPENROUTER_APP_NAME") ?? "OXUS Cloud";
    const siteUrl = optionalEnv("OPENROUTER_SITE_URL");

    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      body = {};
    }

    const planDate = body.date?.trim() || new Date().toISOString().slice(0, 10);
    if (Number.isNaN(new Date(planDate).getTime())) {
      return errorResponse("date must be a valid ISO date (YYYY-MM-DD).", 400, "INVALID_INPUT");
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) {
      return errorResponse("Authentication is required to generate a PM daily plan.", 401, "AUTH_REQUIRED");
    }

    const [
      { data: projects, error: projectsError },
      { data: actions, error: actionsError },
      { data: links, error: linksError },
      { data: timeline, error: timelineError },
      { data: reports, error: reportsError },
    ] = await Promise.all([
      supabase.from("projects").select("id, name, health, risk, status, progress").eq("is_draft", false),
      supabase
        .from("project_pm_action_items")
        .select(
          "id, project_id, title, description, category, priority, status, action_type, execution_status, blocker_type, latest_signal_at, updated_at, created_at, resolution_source, auto_resolved_reason",
        )
        .limit(300),
      supabase.from("project_clickup_links").select("project_id, metadata").eq("status", "active"),
      supabase
        .from("project_clickup_timeline_events")
        .select("project_id, event_title, event_summary, created_at, clickup_task_id")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("project_ai_status_reports")
        .select("project_id, summary, blockers, open_questions, health_recommendation, risk_recommendation, created_at")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (projectsError) return errorResponse("Failed to load projects.", 500, "DB_ERROR", projectsError.message);
    if (actionsError) return errorResponse("Failed to load PM action items.", 500, "DB_ERROR", actionsError.message);
    if (linksError) return errorResponse("Failed to load ClickUp links.", 500, "DB_ERROR", linksError.message);
    if (timelineError) return errorResponse("Failed to load ClickUp timeline.", 500, "DB_ERROR", timelineError.message);
    if (reportsError) return errorResponse("Failed to load status reports.", 500, "DB_ERROR", reportsError.message);

    const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));
    const openActions = (actions ?? [])
      .filter((item) => isOpenPmAction(item as Record<string, unknown>))
      .map((item) => ({
        id: item.id,
        project_id: item.project_id,
        project_name: projectNameById.get(item.project_id) ?? "Unknown",
        title: item.title,
        category: item.category,
        priority: item.priority,
        action_type: item.action_type,
        blocker_type: item.blocker_type,
        latest_signal_at: item.latest_signal_at,
      }));

    const needsReviewProjects = (links ?? [])
      .filter((link) => {
        const metadata = link.metadata as Record<string, unknown> | null;
        return metadata != null && !Array.isArray(metadata) && metadata.needs_ai_review === true;
      })
      .map((link) => ({
        project_id: link.project_id,
        project_name: projectNameById.get(link.project_id) ?? "Unknown",
      }));

    const attentionProjects = (projects ?? [])
      .filter((p) => {
        const projectActions = openActions.filter((a) => a.project_id === p.id);
        const urgent = projectActions.some((a) => a.priority === "urgent" || a.priority === "high");
        const needsReview = needsReviewProjects.some((n) => n.project_id === p.id);
        return (
          p.health === "at-risk" ||
          p.health === "off-track" ||
          p.risk === "medium" ||
          p.risk === "high" ||
          urgent ||
          needsReview
        );
      })
      .map((p) => ({
        id: p.id,
        name: p.name,
        health: p.health,
        risk: p.risk,
        status: p.status,
        open_actions: openActions.filter((a) => a.project_id === p.id).length,
      }));

    const recentTimeline = (timeline ?? []).map((event) => ({
      project_name: projectNameById.get(event.project_id) ?? "Unknown",
      title: event.event_title,
      summary: event.event_summary,
      created_at: event.created_at,
    }));

    const latestReports = (reports ?? []).slice(0, 10).map((report) => ({
      project_name: projectNameById.get(report.project_id) ?? "Unknown",
      summary: report.summary,
      blockers: report.blockers,
      open_questions: report.open_questions,
      health: report.health_recommendation,
      risk: report.risk_recommendation,
      created_at: report.created_at,
    }));

    const messages = [
      {
        role: "system" as const,
        content: [
          "You are an expert agency project manager.",
          "Create a practical plan for today.",
          "Do not repeat resolved or dismissed items.",
          "Prioritize urgent blockers, client questions, and projects with recent unresolved ClickUp activity.",
          "OXUS is the agency/operator (always all caps, never 'Oxus'), not the client. Each project is delivered for its own client; refer to work as helping that client/project, not OXUS.",
          "Keep it concise.",
          "Output valid JSON only with this schema:",
          JSON.stringify({
            summary: "string",
            top_priorities: ["string"],
            project_focus: [
              {
                project_id: "string",
                project_name: "string",
                reason: "string",
                recommended_action: "string",
                urgency: "low | medium | high | urgent",
              },
            ],
            risks: ["string"],
            suggested_order: ["string"],
          }),
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: `Plan date: ${planDate}

Open PM action items:
${compactJson(openActions.slice(0, 40), 3500)}

Projects needing attention:
${compactJson(attentionProjects, 2000)}

Projects with ClickUp updates needing analysis:
${compactJson(needsReviewProjects, 1000)}

Recent ClickUp timeline:
${compactJson(recentTimeline, 2000)}

Latest AI status reports:
${compactJson(latestReports, 2500)}`,
      },
    ];

    let completion: unknown;
    let aiContent = "";
    try {
      const result = await callOpenRouter({
        baseUrl: openRouterBaseUrl,
        apiKey: openRouterApiKey,
        model,
        siteUrl,
        appName,
        messages,
      });
      completion = result.completion;
      aiContent = result.content;
    } catch (error) {
      return errorResponse(
        "OpenRouter request failed while generating PM daily plan.",
        502,
        "OPENROUTER_ERROR",
        (error as Error).message,
      );
    }

    let plan: AiDailyPlan;
    try {
      plan = parseAiJson(aiContent);
    } catch (error) {
      return errorResponse(
        "OpenRouter returned invalid JSON.",
        502,
        "AI_PARSE_ERROR",
        `${(error as Error).message}; response=${aiContent.slice(0, 1200)}`,
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("pm_daily_plans")
      .upsert(
        {
          plan_date: planDate,
          summary: plan.summary || null,
          top_priorities: plan.top_priorities,
          project_focus: plan.project_focus,
          risks: plan.risks,
          suggested_order: plan.suggested_order,
          raw_response: { plan, completion },
          model,
          created_by: auth.user.id,
        },
        { onConflict: "plan_date,created_by" },
      )
      .select()
      .single();

    if (insertError) {
      return errorResponse("Failed to store PM daily plan.", 500, "DB_ERROR", insertError.message);
    }

    return jsonResponse({ plan: inserted });
  } catch (error) {
    return errorResponse(
      "Unexpected error while generating PM daily plan.",
      500,
      "UNEXPECTED_ERROR",
      (error as Error).message,
    );
  }
});
