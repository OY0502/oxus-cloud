import { createClient } from "npm:@supabase/supabase-js@2";
import { blockerSignalToPmAction, detectBlockersFromTimeline, type BlockerSignal } from "../_shared/blockerDetection.ts";
import { buildConversationGroups, type ConversationGroup } from "../_shared/conversationState.ts";
import {
  autoResolveActionsFromConversationGroups,
  filterBlockerSignalsForConversationState,
  shouldSkipCandidateForConversationState,
} from "../_shared/pmActionLifecycle.ts";
import {
  aiActionOverlapsExisting,
  buildAccessCandidate,
  extractResourceFromText,
  inferActionKeyForCandidate,
  dedupeProjectPmActionItems,
  type PmActionCandidate,
  upsertPmActionItem,
} from "../_shared/pmActionDedupe.ts";
import type { SuppressionReason } from "../_shared/pmActionSuppression.ts";
import { syncProjectClickupUpdates } from "../_shared/syncProjectClickupUpdates.ts";
import { buildSlackAnalysisText } from "../_shared/slackAnalysisContext.ts";
import { ensureSlackSignalsProcessed, type ProcessAiJobsResult } from "../_shared/processAiJobs.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";

type ReportType = "manual" | "daily" | "weekly" | "after_clickup_sync";
type HealthRecommendation = "on-track" | "at-risk" | "off-track";
type RiskRecommendation = "none" | "low" | "medium" | "high";
type ActionCategory =
  | "client_question"
  | "developer_followup"
  | "access_needed"
  | "scope_clarification"
  | "risk_review"
  | "qa_followup"
  | "general";
type ActionPriority = "low" | "medium" | "high" | "urgent";
type PmActionType =
  | "manual"
  | "create_clickup_task"
  | "assign_clickup_tasks"
  | "update_clickup_deadline"
  | "add_clickup_comment"
  | "request_access"
  | "ask_client_question"
  | "review_risk"
  | "review_scope";

type AiPmActionPayload = {
  clickup_task_ids?: string[];
  ai_proposed_task_ids?: string[];
  suggested_assignee_role?: string;
  suggested_comment?: string;
  suggested_due_date?: string;
  question_text?: string;
};

type AiPmAction = {
  title: string;
  description: string;
  category: ActionCategory;
  priority: ActionPriority;
  action_type: PmActionType;
  action_payload: AiPmActionPayload;
};

type RequestBody = {
  project_id?: string;
  since?: string;
  report_type?: ReportType;
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

type AiStatusReport = {
  summary: string;
  what_changed: string[];
  blockers: string[];
  risks: string[];
  open_questions: string[];
  pm_actions: AiPmAction[];
  client_updates: string[];
  scope_changes: string[];
  health_recommendation: HealthRecommendation | null;
  risk_recommendation: RiskRecommendation | null;
  confidence: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reportTypes = new Set<ReportType>(["manual", "daily", "weekly", "after_clickup_sync"]);
const healthValues = new Set<HealthRecommendation>(["on-track", "at-risk", "off-track"]);
const riskValues = new Set<RiskRecommendation>(["none", "low", "medium", "high"]);
const actionCategories = new Set<ActionCategory>([
  "client_question",
  "developer_followup",
  "access_needed",
  "scope_clarification",
  "risk_review",
  "qa_followup",
  "general",
]);
const actionPriorities = new Set<ActionPriority>(["low", "medium", "high", "urgent"]);
const pmActionTypes = new Set<PmActionType>([
  "manual",
  "create_clickup_task",
  "assign_clickup_tasks",
  "update_clickup_deadline",
  "add_clickup_comment",
  "request_access",
  "ask_client_question",
  "review_risk",
  "review_scope",
]);

function parseActionPayload(value: unknown): AiPmActionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  return {
    clickup_task_ids: asStringArray(payload.clickup_task_ids),
    ai_proposed_task_ids: asStringArray(payload.ai_proposed_task_ids),
    suggested_assignee_role:
      typeof payload.suggested_assignee_role === "string" ? payload.suggested_assignee_role.trim() : undefined,
    suggested_comment: typeof payload.suggested_comment === "string" ? payload.suggested_comment.trim() : undefined,
    suggested_due_date: typeof payload.suggested_due_date === "string" ? payload.suggested_due_date.trim() : undefined,
    question_text: typeof payload.question_text === "string" ? payload.question_text.trim() : undefined,
  };
}

function inferExecutionStatus(action: AiPmAction): "ready" | "not_started" {
  if (["manual", "review_risk", "review_scope", "ask_client_question", "request_access"].includes(action.action_type)) {
    return "ready";
  }
  if (action.action_type === "assign_clickup_tasks" && (action.action_payload.clickup_task_ids?.length ?? 0) > 0) {
    return "ready";
  }
  if (action.action_type === "update_clickup_deadline" && (action.action_payload.clickup_task_ids?.length ?? 0) > 0) {
    return "ready";
  }
  if (
    action.action_type === "add_clickup_comment" &&
    (action.action_payload.clickup_task_ids?.length ?? 0) > 0 &&
    !!action.action_payload.suggested_comment
  ) {
    return "ready";
  }
  if (action.action_type === "create_clickup_task" && (action.action_payload.ai_proposed_task_ids?.length ?? 0) > 0) {
    return "ready";
  }
  return "not_started";
}

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

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function nullableHealth(value: unknown): HealthRecommendation | null {
  return healthValues.has(value as HealthRecommendation) ? (value as HealthRecommendation) : null;
}

function nullableRisk(value: unknown): RiskRecommendation | null {
  return riskValues.has(value as RiskRecommendation) ? (value as RiskRecommendation) : null;
}

function extractJson(content: string) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return unfenced;
  return unfenced.slice(start, end + 1);
}

function parseAiJson(content: string): AiStatusReport {
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  const actions = Array.isArray(parsed.pm_actions) ? parsed.pm_actions : [];
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    what_changed: asStringArray(parsed.what_changed),
    blockers: asStringArray(parsed.blockers),
    risks: asStringArray(parsed.risks),
    open_questions: asStringArray(parsed.open_questions),
    pm_actions: actions
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .map((item) => {
        const actionType = pmActionTypes.has(item.action_type as PmActionType)
          ? (item.action_type as PmActionType)
          : "manual";
        const actionPayload = parseActionPayload(item.action_payload);
        return {
          title: typeof item.title === "string" ? item.title.trim() : "",
          description: typeof item.description === "string" ? item.description.trim() : "",
          category: actionCategories.has(item.category as ActionCategory) ? (item.category as ActionCategory) : "general",
          priority: actionPriorities.has(item.priority as ActionPriority) ? (item.priority as ActionPriority) : "medium",
          action_type: actionType,
          action_payload: actionPayload,
        };
      })
      .filter((item) => item.title),
    client_updates: asStringArray(parsed.client_updates),
    scope_changes: asStringArray(parsed.scope_changes),
    health_recommendation: nullableHealth(parsed.health_recommendation),
    risk_recommendation: nullableRisk(parsed.risk_recommendation),
    confidence: clampConfidence(parsed.confidence),
  };
}

function compactJson(value: unknown, max = 1600): string {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

function eventTimestamp(event: any): string {
  return event.clickup_date ?? event.created_at ?? "";
}

function buildTimelineText(events: any[], taskNameByClickupId: Map<string, string>): string {
  if (events.length === 0) return "No ClickUp timeline events in this period.";
  return events
    .slice()
    .reverse()
    .map((event) => {
      const taskName = event.clickup_task_id ? taskNameByClickupId.get(event.clickup_task_id) : null;
      return [
        `Event ID: ${event.id}`,
        `Time: ${eventTimestamp(event)}`,
        `Type: ${event.event_type}`,
        `Title: ${event.event_title}`,
        taskName ? `Task: ${taskName}` : event.clickup_task_id ? `Task ID: ${event.clickup_task_id}` : "",
        event.actor_name ? `Actor: ${event.actor_name}` : "",
        event.event_summary ? `Summary: ${event.event_summary}` : "",
        `Payload excerpt: ${compactJson(event.raw_payload, 900)}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n---\n\n");
}

function buildMessages(args: {
  project: any;
  profile: any;
  events: any[];
  slackEvents: any[];
  taskLinks: any[];
  proposedTasks: any[];
  knowledgeSources: any[];
  pmActionItems: any[];
  pmActionExecutions: any[];
  blockerSignals: ReturnType<typeof detectBlockersFromTimeline>;
  conversationGroups: ConversationGroup[];
  periodStart: string | null;
  periodEnd: string;
}) {
  const taskNameByClickupId = new Map<string, string>(
    args.taskLinks
      .filter((task) => task.clickup_task_id)
      .map((task) => [task.clickup_task_id, task.clickup_task_name ?? task.clickup_task_id]),
  );

  const memory = {
    business_goal: args.profile?.business_goal ?? null,
    target_users: args.profile?.target_users ?? [],
    core_flows: args.profile?.core_flows ?? [],
    scope_in: args.profile?.scope_in ?? [],
    scope_out: args.profile?.scope_out ?? [],
    success_criteria: args.profile?.success_criteria ?? [],
    assumptions: args.profile?.assumptions ?? [],
    constraints: args.profile?.constraints ?? [],
    risks: args.profile?.risks ?? [],
    open_questions: args.profile?.open_questions ?? [],
    qa_strategy: args.profile?.qa_strategy ?? null,
    technical_notes: args.profile?.technical_notes ?? [],
    delivery_notes: args.profile?.delivery_notes ?? [],
    current_phase: args.profile?.current_phase ?? null,
    confidence: args.profile?.confidence ?? null,
  };

  const linkedTasks = args.taskLinks.map((task) => ({
    id: task.clickup_task_id,
    name: task.clickup_task_name,
    status: task.clickup_status,
    priority: task.clickup_priority,
    last_synced_at: task.last_synced_at,
  }));

  const proposedTasks = args.proposedTasks.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    confidence: task.confidence,
    clickup_sync_status: task.clickup_sync_status,
  }));

  const openActions = args.pmActionItems
    .filter((item) => item.status === "open" || item.status === "in_progress")
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      action_type: item.action_type,
      category: item.category,
      action_key: item.action_key,
      signal_count: item.signal_count,
      latest_signal_at: item.latest_signal_at,
      blocker_type: item.blocker_type,
      blocker_resource: item.blocker_resource,
      blocked_actor_name: item.blocked_actor_name,
      related_clickup_task_ids: item.related_clickup_task_ids,
      source_event_ids: item.source_event_ids,
    }));

  const closedActions = args.pmActionItems
    .filter((item) => item.status === "done" || item.status === "dismissed")
    .map((item) => ({
      title: item.title,
      status: item.status,
      action_type: item.action_type,
      action_key: item.action_key,
      source_thread_key: item.source_thread_key,
      completed_at: item.completed_at,
      dismissed_at: item.dismissed_at,
      dismiss_reason: item.dismiss_reason,
      resolution_note: item.resolution_note,
      resolution_source: item.resolution_source,
      suppressed_signal_count: item.suppressed_signal_count,
    }));

  const dismissedActions = args.pmActionItems
    .filter((item) => item.status === "dismissed" || item.resolution_source === "dismissed")
    .map((item) => ({
      title: item.title,
      action_key: item.action_key,
      source_thread_key: item.source_thread_key,
      source_type: item.source_type,
      dismissed_at: item.dismissed_at,
      dismiss_reason: item.dismiss_reason,
      signal_type: item.action_payload?.signal_type ?? null,
    }));

  const priorExecutions = args.pmActionExecutions.map((exec) => ({
    action_type: exec.action_type,
    status: exec.status,
    clickup_task_ids: exec.clickup_task_ids,
    created_at: exec.created_at,
    error_message: exec.error_message,
  }));

  const sources = args.knowledgeSources.map((source) => ({
    type: source.source_type,
    title: source.source_title,
    preview: source.source_preview,
    created_at: source.created_at,
  }));

  const conversationGroups = args.conversationGroups.map((group) => ({
    group_id: group.group_id,
    task: group.task_title ?? group.clickup_task_id,
    thread_id: group.clickup_thread_id,
    net_state: group.net_state,
    reason: group.net_state_reason,
    topic_keywords: group.topic_keywords,
    latest_comment: group.latest_comment_text.slice(0, 300),
    resolving_comment: group.resolving_comment_text?.slice(0, 300) ?? null,
  }));

  return [
    {
      role: "system" as const,
      content: [
        "You are an expert project manager for a web-development agency.",
        "Analyze ClickUp task updates, comments, status changes, and project memory.",
        "Identify meaningful changes only.",
        "Do not treat every small status update as important.",
        "Detect blockers, stale work, missing access, unclear requirements, scope changes, QA risks, and client decisions needed.",
        "Create concrete PM actions that are executable in ClickUp when possible.",
        "Use action_type assign_clickup_tasks for resource assignment on existing ClickUp tasks.",
        "Use action_type create_clickup_task when a missing task should be created from an AI proposed task.",
        "Use action_type ask_client_question for client questions.",
        "Use action_type request_access for Slack/ClickUp/Bubble access requests.",
        "Use action_type manual when automation is unsafe.",
        "Include related ClickUp task IDs only when known from linked tasks or timeline.",
        "Include related AI proposed task IDs only when known.",
        "Do not invent task IDs or assignee IDs.",
        "Do not ignore short comments if they indicate a blocker.",
        "Do not return 'no changes' when deterministic blocker signals are present.",
        "Access blocker comments are high priority.",
        "If a developer says they do not have access to a required system, create request_access.",
        "If work is blocked by missing credentials, permissions, invitation, environment access, or app access, create access_needed.",
        "Do not suggest a new PM action if an equivalent open action already exists.",
        "If new events repeat an existing blocker, escalate the existing blocker instead of creating another action.",
        "Repeated access comments on the same task by the same person are the same blocker.",
        "Still don't have access should escalate an existing access blocker, not create a duplicate.",
        "If an action failed, suggest a fix only when there is a clear next step.",
        "If a task was already assigned or deadline set, do not suggest again unless new evidence shows it is unresolved.",
        "Separate facts from assumptions.",
        "Do not invent unsupported information.",
        "If nothing important changed, say so.",
        "OXUS Cloud is the PM control layer. ClickUp is the execution system.",
        "OXUS is the agency/operator (always all caps, never 'Oxus'), not the client. Work is delivered FOR the client/project named below; phrase updates and actions as helping that client/project, not OXUS, unless the client/project is OXUS.",
        "Do not propose internal OXUS tasks.",
        "Do not overwhelm the PM with already-handled items.",
        "If a later comment in the same thread says please disregard, I received it, got it, or works now, treat the issue as resolved.",
        "Do not create PM actions for issues that were later resolved in the same thread or task context.",
        "If an old request was resolved in-thread, you may mention it in the report summary, but do not create a PM action.",
        "Only create PM actions for unresolved issues.",
        "Slack messages are informal and noisy.",
        "Only create PM actions from Slack if a message indicates a real blocker, unresolved client question, decision, scope change, or unresolved request.",
        "If a Slack thread resolves itself later, do not create an open PM action.",
        "Do not create actions from thanks, got it, casual chatter, or resolved Slack threads.",
        "If a PM dismissed an action for a thread or source, do not suggest it again.",
        "Treat dismissal as human feedback that the action is not needed.",
        "Only suggest a dismissed action again if there is materially new information from a new thread/source or explicit urgency.",
        "Internal Slack may contain agency-only operational notes.",
        "External/client-facing Slack has higher importance for client questions and decisions.",
        "Do not expose internal-only Slack content in client_updates.",
        "When Slack indicates a PM action, include action_payload fields: source=slack, slack_event_ids, slack_channel_id, slack_thread_ts, link_type when known.",
        "Output valid JSON only.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: `Return strict JSON with this shape:
{
  "summary": "string",
  "what_changed": ["string"],
  "blockers": ["string"],
  "risks": ["string"],
  "open_questions": ["string"],
  "pm_actions": [
    {
      "title": "string",
      "description": "string",
      "category": "client_question | developer_followup | access_needed | scope_clarification | risk_review | qa_followup | general",
      "priority": "low | medium | high | urgent",
      "action_type": "manual | create_clickup_task | assign_clickup_tasks | update_clickup_deadline | add_clickup_comment | request_access | ask_client_question | review_risk | review_scope",
      "action_payload": {
        "clickup_task_ids": ["string"],
        "ai_proposed_task_ids": ["string"],
        "suggested_assignee_role": "string",
        "suggested_comment": "string",
        "suggested_due_date": "string",
        "question_text": "string",
        "source": "slack",
        "slack_event_ids": ["string"],
        "slack_channel_id": "string",
        "slack_thread_ts": "string",
        "link_type": "internal | external | other"
      }
    }
  ],
  "client_updates": ["string"],
  "scope_changes": ["string"],
  "health_recommendation": "on-track | at-risk | off-track | null",
  "risk_recommendation": "none | low | medium | high | null",
  "confidence": 0.0
}

Current project:
${JSON.stringify({
  id: args.project.id,
  name: args.project.name,
  client_name: (args.project as { client_name?: string | null }).client_name ?? null,
  description: args.project.description,
  status: args.project.status,
  health: args.project.health,
  risk: args.project.risk,
  progress: args.project.progress,
  deadline: args.project.deadline,
})}

Report period:
${JSON.stringify({ period_start: args.periodStart, period_end: args.periodEnd })}

Project memory:
${JSON.stringify(memory)}

Linked ClickUp tasks:
${JSON.stringify(linkedTasks)}

Recent AI proposed tasks:
${JSON.stringify(proposedTasks)}

Open / in-progress PM action items (do not duplicate these):
${JSON.stringify(openActions)}

Recently completed / dismissed PM action items:
${JSON.stringify(closedActions)}

Dismissed PM actions (do not recreate unless materially new):
${JSON.stringify(dismissedActions)}

Recent PM action executions:
${JSON.stringify(priorExecutions)}

Deterministic blocker signals already detected (must create PM actions for these unless conversation state is resolved):
${JSON.stringify(args.blockerSignals)}

Grouped ClickUp conversation states (respect resolved_issue groups — do not create actions for them):
${JSON.stringify(conversationGroups)}

Recent memory sources:
${JSON.stringify(sources)}

ClickUp timeline:
${buildTimelineText(args.events, taskNameByClickupId)}

Slack signals (include_in_ai only; grouped by thread — respect resolved threads):
${buildSlackAnalysisText(args.slackEvents)}`,
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
  const completion = JSON.parse(responseText);
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`model=${args.model}; status=${response.status}; empty message content`);
  }
  return { completion, content };
}

function worseHealth(recommended: HealthRecommendation, current: HealthRecommendation): boolean {
  const rank: Record<HealthRecommendation, number> = { "on-track": 0, "at-risk": 1, "off-track": 2 };
  return rank[recommended] > rank[current];
}

function worseRisk(recommended: RiskRecommendation, current: RiskRecommendation): boolean {
  const rank: Record<RiskRecommendation, number> = { none: 0, low: 1, medium: 2, high: 3 };
  return rank[recommended] > rank[current];
}

function aiActionToCandidate(action: AiPmAction, signalAt: string): PmActionCandidate {
  const taskIds = action.action_payload.clickup_task_ids ?? [];
  const resource = extractResourceFromText(`${action.title} ${action.description ?? ""}`);
  const isAccess = action.action_type === "request_access" || action.category === "access_needed";
  return {
    title: action.title,
    description: action.description || null,
    category: action.category,
    priority: action.priority,
    action_type: action.action_type,
    action_payload: action.action_payload,
    source: "ai_status_report",
    source_event_ids: [],
    execution_status: inferExecutionStatus(action),
    action_key: null,
    blocker_type: isAccess ? "access" : null,
    blocker_resource: resource,
    blocked_actor_name: null,
    blocked_actor_email: null,
    related_clickup_task_ids: taskIds,
    related_clickup_task_titles: [],
    last_signal_summary: action.description || null,
    signal_at: signalAt,
    is_escalation: false,
  };
}

function signalToCandidate(signal: BlockerSignal, projectId: string, existingItems: any[]): PmActionCandidate {
  if (signal.kind === "access_blocker") {
    return buildAccessCandidate({
      projectId,
      commentText: signal.comment_text,
      sourceEventId: signal.source_event_id,
      signalAt: signal.signal_at,
      clickupTaskId: signal.clickup_task_id,
      taskTitle: signal.task_title,
      actorName: signal.actor_name,
      actorEmail: signal.actor_email,
      existingItems,
    });
  }

  const deterministic = blockerSignalToPmAction(signal);
  return {
    title: deterministic.title,
    description: deterministic.description,
    category: deterministic.category,
    priority: deterministic.priority,
    action_type: deterministic.action_type,
    action_payload: deterministic.action_payload,
    source: "clickup_timeline",
    source_event_ids: deterministic.source_event_ids,
    execution_status: "ready",
    action_key: null,
    blocker_type: null,
    blocker_resource: null,
    blocked_actor_name: signal.actor_name,
    blocked_actor_email: signal.actor_email,
    related_clickup_task_ids: signal.clickup_task_id ? [signal.clickup_task_id] : [],
    related_clickup_task_titles: signal.task_title ? [signal.task_title] : [],
    last_signal_summary: signal.comment_text,
    signal_at: signal.signal_at,
    is_escalation: signal.is_escalation,
  };
}

function collectPmActionCandidates(
  aiActions: AiPmAction[],
  blockerSignals: BlockerSignal[],
  projectId: string,
  existingItems: any[],
  periodEnd: string,
  conversationGroups: ConversationGroup[],
): PmActionCandidate[] {
  const candidates: PmActionCandidate[] = [];
  const seenKeys = new Set<string>();
  const workingItems = [...existingItems];

  const sortedSignals = [...blockerSignals].sort(
    (a, b) => new Date(a.signal_at).getTime() - new Date(b.signal_at).getTime(),
  );

  for (const signal of sortedSignals) {
    const candidate = signalToCandidate(signal, projectId, workingItems);
    if (shouldSkipCandidateForConversationState(candidate, conversationGroups, projectId)) continue;
    const key = inferActionKeyForCandidate(projectId, candidate);
    if (key) seenKeys.add(key);
    candidates.push(candidate);
  }

  for (const action of aiActions) {
    const candidate = aiActionToCandidate(action, periodEnd);
    if (shouldSkipCandidateForConversationState(candidate, conversationGroups, projectId)) continue;
    if (aiActionOverlapsExisting(candidate, workingItems, projectId)) continue;
    const key = inferActionKeyForCandidate(projectId, candidate);
    if (key && seenKeys.has(key)) continue;
    if (
      key &&
      candidates.some((item) => inferActionKeyForCandidate(projectId, item) === key)
    ) {
      continue;
    }
    candidates.push(candidate);
    if (key) seenKeys.add(key);
  }

  return candidates;
}

async function persistPmActionCandidates(args: {
  supabase: any;
  projectId: string;
  statusReportId: string;
  candidates: PmActionCandidate[];
  existingItems: any[];
  createdBy: string;
}): Promise<{ items: any[]; suppressed: number; suppression_reasons: SuppressionReason[] }> {
  const workingItems = [...args.existingItems];
  const results: any[] = [];
  const suppressionReasons: SuppressionReason[] = [];
  let suppressed = 0;

  for (const candidate of args.candidates) {
    const { item, suppressed: wasSuppressed, suppressionReason } = await upsertPmActionItem({
      supabase: args.supabase,
      projectId: args.projectId,
      statusReportId: args.statusReportId,
      candidate,
      existingItems: workingItems,
      createdBy: args.createdBy,
    });
    if (wasSuppressed) {
      suppressed++;
      if (suppressionReason) suppressionReasons.push(suppressionReason);
      continue;
    }
    results.push(item);
    const idx = workingItems.findIndex((row) => row.id === item.id);
    if (idx >= 0) workingItems[idx] = item;
    else workingItems.unshift(item);
  }

  return { items: results, suppressed, suppression_reasons: suppressionReasons };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication is required to generate a project status report.", 401, "AUTH_REQUIRED");
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

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return errorResponse("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id;
    if (!projectId) return errorResponse("project_id is required.", 400, "INVALID_INPUT");
    const reportType = reportTypes.has(body.report_type as ReportType) ? (body.report_type as ReportType) : "manual";
    const since = body.since?.trim() || null;
    if (since && Number.isNaN(new Date(since).getTime())) {
      return errorResponse("since must be a valid ISO timestamp.", 400, "INVALID_INPUT");
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) {
      return errorResponse("Authentication is required to generate a project status report.", 401, "AUTH_REQUIRED");
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name, client_name, description, status, health, risk, progress, deadline")
      .eq("id", projectId)
      .single();
    if (projectError || !project) {
      return errorResponse("Project was not found or is not accessible.", 404, "PROJECT_NOT_FOUND", projectError?.message);
    }

    let clickupSyncResult: Awaited<ReturnType<typeof syncProjectClickupUpdates>> | null = null;
    try {
      const { clickup } = await resolveUserClickupForProject(auth.user.id, projectId);
      clickupSyncResult = await syncProjectClickupUpdates({
        supabase,
        clickup,
        projectId,
        syncedVia: "generate-project-status-report",
      });
    } catch (syncError) {
      if (syncError instanceof ClickupAuthError) {
        return clickupAuthErrorResponse(syncError, corsHeaders);
      }
      console.warn("[generate-project-status-report] ClickUp sync failed (continuing):", (syncError as Error).message);
    }

    const [
      { data: profile },
      { data: latestReport },
      { data: taskLinks, error: taskLinksError },
      { data: proposedTasks, error: proposedError },
      { data: knowledgeSources, error: sourcesError },
      { data: pmActionItems, error: pmItemsError },
      { data: pmActionExecutions, error: pmExecError },
      { data: slackLinks },
      { data: slackEvents, error: slackEventsError },
    ] = await Promise.all([
      supabase.from("project_pm_profiles").select("*").eq("project_id", projectId).maybeSingle(),
      supabase
        .from("project_ai_status_reports")
        .select("id, created_at, period_end")
        .eq("project_id", projectId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("clickup_task_links")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("ai_proposed_tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("project_knowledge_sources")
        .select("id, source_type, source_title, source_preview, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("project_pm_action_items")
        .select(
          "id, title, description, status, category, priority, action_type, execution_status, executed_at, completed_at, action_payload, created_at, action_key, blocker_type, blocker_resource, blocked_actor_name, blocked_actor_email, related_clickup_task_ids, related_clickup_task_titles, signal_count, first_signal_at, latest_signal_at, last_signal_summary, resolution_note, resolution_source, auto_resolved_by_event_id, auto_resolved_reason, source_event_ids, source_type, source_thread_key, dismissed_at, dismiss_reason, suppressed_signal_count, latest_suppressed_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("project_pm_action_executions")
        .select("id, action_type, status, clickup_task_ids, error_message, created_at, action_item_id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("project_slack_links").select("slack_channel_id, channel_name").eq("project_id", projectId),
      supabase
        .from("project_slack_events")
        .select(
          "id, slack_channel_id, slack_ts, slack_thread_ts, message_preview, message_text, signal_type, signal_confidence, link_type, is_client_facing, include_in_client_updates, slack_user_name, created_at",
        )
        .eq("project_id", projectId)
        .eq("include_in_ai", true)
        .neq("signal_type", "noise")
        .order("created_at", { ascending: false })
        .limit(80),
    ]);
    if (taskLinksError) return errorResponse("Failed to load ClickUp task links.", 500, "DB_ERROR", taskLinksError.message);
    if (proposedError) return errorResponse("Failed to load AI proposed tasks.", 500, "DB_ERROR", proposedError.message);
    if (sourcesError) return errorResponse("Failed to load project memory sources.", 500, "DB_ERROR", sourcesError.message);
    if (pmItemsError) return errorResponse("Failed to load PM action items.", 500, "DB_ERROR", pmItemsError.message);
    if (pmExecError) return errorResponse("Failed to load PM action executions.", 500, "DB_ERROR", pmExecError.message);
    if (slackEventsError) return errorResponse("Failed to load Slack events.", 500, "DB_ERROR", slackEventsError.message);

    let currentPmActionItems = pmActionItems ?? [];

    const channelNameById = new Map(
      (slackLinks ?? []).map((link: { slack_channel_id: string; channel_name: string | null }) => [
        link.slack_channel_id,
        link.channel_name,
      ]),
    );
    const slackEventsForAnalysis = (slackEvents ?? []).map((event: Record<string, unknown>) => ({
      ...event,
      channel_name: channelNameById.get(event.slack_channel_id as string) ?? null,
    }));

    const periodEnd = new Date().toISOString();
    const fallbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const periodStart = since || latestReport?.period_end || latestReport?.created_at || fallbackStart;

    let eventsQuery = supabase
      .from("project_clickup_timeline_events")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (since || latestReport) eventsQuery = eventsQuery.gte("created_at", periodStart);
    else eventsQuery = eventsQuery.gte("created_at", fallbackStart);

    let { data: events, error: eventsError } = await eventsQuery;
    if (eventsError) return errorResponse("Failed to load ClickUp timeline events.", 500, "DB_ERROR", eventsError.message);

    if (!since && !latestReport && (!events || events.length === 0)) {
      const latestEvents = await supabase
        .from("project_clickup_timeline_events")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (latestEvents.error) return errorResponse("Failed to load recent ClickUp timeline events.", 500, "DB_ERROR", latestEvents.error.message);
      events = latestEvents.data ?? [];
    }

    const sourceEventIds = (events ?? []).map((event: any) => event.id);

    let slackPipelineResult: ProcessAiJobsResult = {
      processed_count: 0,
      failed_count: 0,
      actions_created_count: 0,
      actions_updated_count: 0,
      actions_auto_resolved_count: 0,
      actions_skipped_count: 0,
      actions_suppressed_count: 0,
      timeline_events_created_count: 0,
      timeline_events_updated_count: 0,
      threads_checked: 0,
      duplicates_avoided: 0,
      noise_skipped_count: 0,
      signals_checked: 0,
      signals_new: 0,
      signals_already_processed: 0,
      reasons: [],
      job_ids: [],
      suppression_reasons: [],
    };
    try {
      slackPipelineResult = await ensureSlackSignalsProcessed({
        admin: supabase,
        projectId,
        createdBy: auth.user.id,
      });
    } catch (slackPipelineError) {
      console.warn(
        "[generate-project-status-report] slack pipeline failed:",
        (slackPipelineError as Error).message,
      );
      slackPipelineResult.reasons.push((slackPipelineError as Error).message);
    }

    if (slackPipelineResult.actions_created_count > 0) {
      const { data: refreshedPmItems, error: refreshError } = await supabase
        .from("project_pm_action_items")
        .select(
          "id, title, description, status, category, priority, action_type, execution_status, executed_at, completed_at, action_payload, created_at, action_key, blocker_type, blocker_resource, blocked_actor_name, blocked_actor_email, related_clickup_task_ids, related_clickup_task_titles, signal_count, first_signal_at, latest_signal_at, last_signal_summary, resolution_note, resolution_source, auto_resolved_by_event_id, auto_resolved_reason, source_event_ids, source",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!refreshError && refreshedPmItems) {
        currentPmActionItems = refreshedPmItems;
      }
    }

    const hasClickupEvents = (events ?? []).length > 0;
    const hasSlackEvents = (slackEvents ?? []).length > 0;
    const conversationGroups = buildConversationGroups(events ?? [], taskLinks ?? []);

    let workingPmActionItems = [...currentPmActionItems];
    let autoResolvedItems: any[] = [];
    try {
      const autoResolveResult = await autoResolveActionsFromConversationGroups({
        supabase,
        projectId,
        groups: conversationGroups,
        existingItems: workingPmActionItems,
        createdBy: auth.user.id,
      });
      autoResolvedItems = autoResolveResult.resolved;
      for (const item of autoResolveResult.resolved) {
        const idx = workingPmActionItems.findIndex((row) => row.id === item.id);
        if (idx >= 0) workingPmActionItems[idx] = item;
      }
    } catch (autoResolveError) {
      console.warn("[generate-project-status-report] auto-resolve failed:", (autoResolveError as Error).message);
    }

    const blockerSignals = filterBlockerSignalsForConversationState(
      detectBlockersFromTimeline(events ?? [], taskLinks ?? [], workingPmActionItems),
      conversationGroups,
    );

    if (!hasClickupEvents && !hasSlackEvents) {
      const noChange = {
        summary:
          "No ClickUp updates or Slack signals were found for this project in the selected period. Sync ClickUp or Slack channels first, then analyze again.",
        what_changed: [],
        blockers: [],
        risks: [],
        open_questions: [],
        pm_actions: [],
        client_updates: [],
        scope_changes: [],
        health_recommendation: null,
        risk_recommendation: null,
        confidence: 1,
        slack_pipeline: slackPipelineResult,
      };
      const { data: report, error: insertError } = await supabase
        .from("project_ai_status_reports")
        .insert({
          project_id: projectId,
          report_type: reportType,
          period_start: periodStart,
          period_end: periodEnd,
          summary: noChange.summary,
          what_changed: [],
          blockers: [],
          risks: [],
          open_questions: [],
          pm_actions: [],
          client_updates: [],
          scope_changes: [],
          health_recommendation: null,
          risk_recommendation: null,
          confidence: 1,
          source_event_ids: [],
          raw_response: noChange,
          model: null,
          status: "completed",
          created_by: auth.user.id,
        })
        .select()
        .single();
      if (insertError) return errorResponse("Failed to store status report.", 500, "DB_ERROR", insertError.message);

      const { data: latestActions } = await supabase
        .from("project_pm_action_items")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      return jsonResponse({
        report,
        action_items: latestActions ?? [],
        slack_pipeline: slackPipelineResult,
      });
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
        messages: buildMessages({
          project,
          profile,
          events,
          slackEvents: slackEventsForAnalysis,
          taskLinks: taskLinks ?? [],
          proposedTasks: proposedTasks ?? [],
          knowledgeSources: knowledgeSources ?? [],
          pmActionItems: currentPmActionItems,
          pmActionExecutions: pmActionExecutions ?? [],
          blockerSignals,
          conversationGroups,
          periodStart,
          periodEnd,
        }),
      });
      completion = result.completion;
      aiContent = result.content;
    } catch (error) {
      return errorResponse("OpenRouter request failed while generating project status report.", 502, "OPENROUTER_ERROR", (error as Error).message);
    }

    let analysis: AiStatusReport;
    try {
      analysis = parseAiJson(aiContent);
    } catch (error) {
      return errorResponse(
        "OpenRouter returned invalid JSON.",
        502,
        "AI_PARSE_ERROR",
        `${(error as Error).message}; response=${aiContent.slice(0, 1200)}`,
      );
    }

    if (blockerSignals.length > 0) {
      const blockerSummaries = blockerSignals.map((signal) => signal.summary);
      analysis.blockers = [...new Set([...analysis.blockers, ...blockerSummaries])];
      if (
        !analysis.summary ||
        /no (clickup )?updates|nothing important|no changes|no new/i.test(analysis.summary)
      ) {
        analysis.summary = `Access blocker(s) detected from ClickUp comments. ${blockerSummaries.join(" ")}`;
      }
      if (analysis.pm_actions.length === 0) {
        analysis.pm_actions = blockerSignals.map((signal) => {
          const action = blockerSignalToPmAction(signal);
          return {
            title: action.title,
            description: action.description,
            category: action.category as ActionCategory,
            priority: action.priority,
            action_type: action.action_type as PmActionType,
            action_payload: action.action_payload,
          };
        });
      }
    }

    const actionCandidates = collectPmActionCandidates(
      analysis.pm_actions,
      blockerSignals,
      projectId,
      workingPmActionItems,
      periodEnd,
      conversationGroups,
    );

    const { data: report, error: reportError } = await supabase
      .from("project_ai_status_reports")
      .insert({
        project_id: projectId,
        report_type: reportType,
        period_start: periodStart,
        period_end: periodEnd,
        summary: analysis.summary,
        what_changed: analysis.what_changed,
        blockers: analysis.blockers,
        risks: analysis.risks,
        open_questions: analysis.open_questions,
        pm_actions: actionCandidates.map((action) => action.title),
        client_updates: analysis.client_updates,
        scope_changes: analysis.scope_changes,
        health_recommendation: analysis.health_recommendation,
        risk_recommendation: analysis.risk_recommendation,
        confidence: analysis.confidence,
        source_event_ids: sourceEventIds,
        raw_response: { analysis, completion, blocker_signals: blockerSignals, conversation_groups: conversationGroups, clickup_sync: clickupSyncResult, slack_pipeline: slackPipelineResult },
        model,
        status: "completed",
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (reportError) return errorResponse("Failed to store status report.", 500, "DB_ERROR", reportError.message);

    let actionItems: unknown[] = [];
    if (actionCandidates.length > 0) {
      try {
        const persisted = await persistPmActionCandidates({
          supabase,
          projectId,
          statusReportId: report.id,
          candidates: actionCandidates,
          existingItems: workingPmActionItems,
          createdBy: auth.user.id,
        });
        actionItems = persisted.items;
        if (persisted.suppressed > 0) {
          slackPipelineResult.actions_suppressed_count =
            (slackPipelineResult.actions_suppressed_count ?? 0) + persisted.suppressed;
          slackPipelineResult.suppression_reasons = [
            ...(slackPipelineResult.suppression_reasons ?? []),
            ...persisted.suppression_reasons,
          ];
        }
      } catch (persistError) {
        return errorResponse(
          "Failed to store PM action items.",
          500,
          "DB_ERROR",
          (persistError as Error).message,
        );
      }
    }

    try {
      await dedupeProjectPmActionItems({ supabase, projectId });
    } catch (dedupeError) {
      console.warn("[generate-project-status-report] dedupe failed:", (dedupeError as Error).message);
    }

    const projectPatch: Record<string, unknown> = {};
    const hasSeriousSignals = analysis.blockers.length > 0 || analysis.risks.length > 0;
    if (
      analysis.confidence >= 0.75 &&
      hasSeriousSignals &&
      analysis.health_recommendation &&
      worseHealth(analysis.health_recommendation, project.health as HealthRecommendation)
    ) {
      projectPatch.health = analysis.health_recommendation;
    }
    if (
      analysis.confidence >= 0.75 &&
      hasSeriousSignals &&
      analysis.risk_recommendation &&
      worseRisk(analysis.risk_recommendation, project.risk as RiskRecommendation)
    ) {
      projectPatch.risk = analysis.risk_recommendation;
    }

    if (Object.keys(projectPatch).length > 0) {
      const { error: updateError } = await supabase.from("projects").update(projectPatch).eq("id", projectId);
      if (updateError) return errorResponse("Status report was saved, but project health/risk update failed.", 500, "DB_ERROR", updateError.message);
    }

    const { data: projectLink } = await supabase
      .from("project_clickup_links")
      .select("id, metadata")
      .eq("project_id", projectId)
      .maybeSingle();
    if (projectLink) {
      await supabase
        .from("project_clickup_links")
        .update({
          metadata: {
            ...(projectLink.metadata ?? {}),
            needs_ai_review: false,
            last_ai_reviewed_at: new Date().toISOString(),
          },
        })
        .eq("id", projectLink.id);
    }

    const { data: latestActionItems, error: latestActionsError } = await supabase
      .from("project_pm_action_items")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (latestActionsError) {
      console.warn("[generate-project-status-report] action reload failed:", latestActionsError.message);
    }

    return jsonResponse({
      report,
      action_items: latestActionItems ?? [...autoResolvedItems, ...actionItems],
      clickup_sync: clickupSyncResult,
      conversation_groups: conversationGroups,
      slack_pipeline: slackPipelineResult,
    });
  } catch (error) {
    console.error("[UNEXPECTED_ERROR]", (error as Error).message);
    return errorResponse("Failed to generate project status report.", 500, "UNEXPECTED_ERROR", (error as Error).message);
  }
});
