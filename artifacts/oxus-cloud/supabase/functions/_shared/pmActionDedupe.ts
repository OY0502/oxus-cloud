/** PM action dedupe keys, merge/upsert, and access-blocker helpers. */

import {
  actionFamilyFromItem,
  findExistingActionForSignal,
  proposedFromCandidate,
  recordActionSuppression,
  suppressionReasonFromMatch,
  type SuppressionReason,
} from "./pmActionSuppression.ts";
import {
  buildActionIdentityForSlackSignal,
  buildFallbackActionIdentity,
  actionFamiliesEquivalent,
  inferActionFamilyFromText,
} from "./pmActionIdentity.ts";
import {
  upsertPmActionFromSignal,
  normalizePmActionSourceType,
  type UpsertPmActionInput,
} from "./pmActionUpsert.ts";

export type ActionPriority = "low" | "medium" | "high" | "urgent";

export type PmActionCandidate = {
  title: string;
  description: string | null;
  category: string;
  priority: ActionPriority;
  action_type: string;
  action_payload: Record<string, unknown>;
  source: "ai_status_report" | "clickup_timeline";
  source_event_ids: string[];
  execution_status: "ready" | "not_started";
  action_key: string | null;
  blocker_type: string | null;
  blocker_resource: string | null;
  blocked_actor_name: string | null;
  blocked_actor_email: string | null;
  related_clickup_task_ids: string[];
  related_clickup_task_titles: string[];
  last_signal_summary: string | null;
  signal_at: string;
  is_escalation: boolean;
  source_thread_key?: string | null;
  source_type?: string | null;
  signal_type?: string | null;
  action_identity?: string | null;
};

export type UpsertPmActionResult = {
  item: any;
  merged: boolean;
  reopened: boolean;
  suppressed: boolean;
  suppressionReason?: SuppressionReason;
};

const KNOWN_RESOURCES = [
  "bubble app",
  "bubble",
  "clickup",
  "slack",
  "figma",
  "zoom",
  "staging",
  "production",
  "credentials",
  "database",
  "server",
];

const REQUEST_TOPIC_KEYWORDS = ["csv", "sample", "file", "upload", "bulk", "access", "bubble", "credentials", "figma", "slack", "clickup"];

function extractRequestTopicKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return [...new Set(REQUEST_TOPIC_KEYWORDS.filter((keyword) => lower.includes(keyword)))];
}

const ESCALATION_PATTERNS = [
  /\bstill\s+don'?t\s+have\s+access\b/i,
  /\bstill\s+no\s+access\b/i,
  /\bstill\s+waiting\s+for\s+access\b/i,
  /\bcould\s+you\s+check\b/i,
  /\bfollowing\s+up\b/i,
  /\bany\s+update\b/i,
];

const PRIORITY_RANK: Record<ActionPriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

export function normalizeSlug(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || fallback;
}

export function extractResourceFromText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:don'?t|do not|cannot|can't|no)\s+have\s+access\s+to\s+(?:the\s+)?(.+?)(?:[.!?,]|$)/i,
    /need\s+access\s+to\s+(?:the\s+)?(.+?)(?:[.!?,]|$)/i,
    /waiting\s+for\s+access\s+to\s+(?:the\s+)?(.+?)(?:[.!?,]|$)/i,
    /access\s+to\s+(?:the\s+)?(.+?)(?:\s+app)?(?:[.!?,]|$)/i,
    /cannot\s+access\s+(?:the\s+)?(.+?)(?:[.!?,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim().replace(/\s+app$/i, "").trim();
      if (name.length > 1 && name.length < 80) return name;
    }
  }
  const lower = normalized.toLowerCase();
  for (const known of KNOWN_RESOURCES) {
    if (lower.includes(known)) {
      return known === "bubble" ? "Bubble app" : known.charAt(0).toUpperCase() + known.slice(1);
    }
  }
  return null;
}

export function isEscalationComment(text: string): boolean {
  return ESCALATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildAccessActionKey(args: {
  projectId: string;
  clickupTaskId: string | null;
  actorName: string | null;
  resource: string | null;
}): string {
  const taskPart = args.clickupTaskId ? normalizeSlug(args.clickupTaskId, "project-level") : "project-level";
  const actorPart = normalizeSlug(args.actorName, "unknown-actor");
  const resourcePart = normalizeSlug(args.resource, "unknown-resource");
  return `access:${args.projectId}:${taskPart}:${actorPart}:${resourcePart}`;
}

export function buildRequestFileActionKey(args: {
  projectId: string;
  clickupTaskId: string | null;
  actorName: string | null;
  topicSlug: string;
}): string {
  const taskPart = args.clickupTaskId ? normalizeSlug(args.clickupTaskId, "project-level") : "project-level";
  const actorPart = normalizeSlug(args.actorName, "unknown-actor");
  const topicPart = normalizeSlug(args.topicSlug, "general-topic");
  return `request_file:${args.projectId}:${taskPart}:${actorPart}:${topicPart}`;
}

export function inferResourceFromExistingActions(
  existingItems: Array<{
    action_key?: string | null;
    action_type?: string | null;
    category?: string | null;
    blocker_type?: string | null;
    blocker_resource?: string | null;
    action_payload?: Record<string, unknown> | null;
    related_clickup_task_ids?: string[] | null;
    blocked_actor_name?: string | null;
    status?: string;
  }>,
  clickupTaskId: string | null,
  actorName: string | null,
): string | null {
  const actorSlug = normalizeSlug(actorName, "");
  for (const item of existingItems) {
    const isAccess =
      item.blocker_type === "access" ||
      item.action_type === "request_access" ||
      item.category === "access_needed";
    if (!isAccess) continue;
    if (clickupTaskId && !(item.related_clickup_task_ids ?? []).includes(clickupTaskId)) continue;
    if (actorSlug && item.blocked_actor_name && normalizeSlug(item.blocked_actor_name, "") !== actorSlug) continue;
    if (item.blocker_resource) return item.blocker_resource;
    const payloadResource = item.action_payload?.system_name;
    if (typeof payloadResource === "string" && payloadResource.trim()) return payloadResource.trim();
  }
  return null;
}

export function buildAccessBlockerTitle(resource: string | null, actorName: string | null): string {
  const resourceLabel = resource ?? "required system";
  const actorLabel = actorName?.trim() || "developer";
  return `Grant ${resourceLabel} access to ${actorLabel}`;
}

export function buildAccessRequestCopy(args: {
  resource: string | null;
  actorName: string | null;
  taskTitle: string | null;
}): string {
  const resourceLabel = args.resource ?? "the required system";
  const actorLabel = args.actorName?.trim() || "the assigned developer";
  const taskSentence = args.taskTitle
    ? ` for the task "${args.taskTitle}"`
    : "";
  return [
    `Could you please grant ${actorLabel} access to ${resourceLabel}${taskSentence}?`,
    "",
    `${actorLabel.split(" ")[0] ?? "They"} is currently blocked and cannot continue until access is provided.`,
  ].join("\n");
}

export function raisePriority(current: ActionPriority, next: ActionPriority): ActionPriority {
  return PRIORITY_RANK[next] > PRIORITY_RANK[current] ? next : current;
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0))];
}

function mergeDescription(existing: string | null, actorName: string | null, taskTitle: string | null, summary: string, isEscalation: boolean): string {
  const actor = actorName ?? "The developer";
  const taskPart = taskTitle ? ` on task '${taskTitle}'` : "";
  const base = existing?.trim() ?? `${actor} reported missing access${taskPart}.`;
  if (isEscalation) {
    return `${base} ${actor} later followed up that access is still missing.`;
  }
  if (existing && summary && !existing.includes(summary)) {
    return `${base} Latest comment: "${summary}"`;
  }
  return base;
}

export function buildAccessCandidate(args: {
  projectId: string;
  commentText: string;
  sourceEventId: string;
  signalAt: string;
  clickupTaskId: string | null;
  taskTitle: string | null;
  actorName: string | null;
  actorEmail: string | null;
  existingItems: any[];
}): PmActionCandidate {
  const isEscalation = isEscalationComment(args.commentText);
  let resource = extractResourceFromText(args.commentText);
  if (!resource) {
    resource = inferResourceFromExistingActions(args.existingItems, args.clickupTaskId, args.actorName);
  }
  const actionKey = buildAccessActionKey({
    projectId: args.projectId,
    clickupTaskId: args.clickupTaskId,
    actorName: args.actorName,
    resource,
  });
  const priority: ActionPriority = isEscalation ? "urgent" : "high";
  const title = buildAccessBlockerTitle(resource, args.actorName);
  const description = mergeDescription(null, args.actorName, args.taskTitle, args.commentText, isEscalation);
  const questionText = buildAccessRequestCopy({
    resource,
    actorName: args.actorName,
    taskTitle: args.taskTitle,
  });

  return {
    title,
    description,
    category: "access_needed",
    priority,
    action_type: "request_access",
    action_payload: {
      clickup_task_ids: args.clickupTaskId ? [args.clickupTaskId] : [],
      question_text: questionText,
      system_name: resource,
      comment_text: args.commentText,
      blocker_kind: "access_blocker",
    },
    source: "clickup_timeline",
    source_event_ids: [args.sourceEventId],
    execution_status: "ready",
    action_key: actionKey,
    blocker_type: "access",
    blocker_resource: resource,
    blocked_actor_name: args.actorName,
    blocked_actor_email: args.actorEmail,
    related_clickup_task_ids: args.clickupTaskId ? [args.clickupTaskId] : [],
    related_clickup_task_titles: args.taskTitle ? [args.taskTitle] : [],
    last_signal_summary: args.commentText,
    signal_at: args.signalAt,
    is_escalation: isEscalation,
  };
}

export function inferActionKeyForCandidate(projectId: string, candidate: PmActionCandidate): string | null {
  if (candidate.action_key) return candidate.action_key;

  if (candidate.action_type === "request_access" || candidate.category === "access_needed") {
    const taskId = candidate.related_clickup_task_ids[0] ?? null;
    return buildAccessActionKey({
      projectId,
      clickupTaskId: taskId,
      actorName: candidate.blocked_actor_name,
      resource: candidate.blocker_resource ?? extractResourceFromText(candidate.last_signal_summary ?? candidate.description ?? candidate.title),
    });
  }

  const text = `${candidate.title} ${candidate.description ?? ""} ${candidate.last_signal_summary ?? ""}`;
  const keywords = extractRequestTopicKeywords(text);
  const isFileRequest =
    candidate.action_type === "ask_client_question" ||
    candidate.category === "client_question" ||
    keywords.some((keyword) => ["csv", "sample", "file", "upload", "bulk"].includes(keyword)) ||
    /\b(do we have|provide|sample|csv)\b/i.test(text);

  if (isFileRequest && keywords.length > 0) {
    return buildRequestFileActionKey({
      projectId,
      clickupTaskId: candidate.related_clickup_task_ids[0] ?? null,
      actorName: candidate.blocked_actor_name,
      topicSlug: keywords.slice(0, 3).join("-"),
    });
  }

  return null;
}

function findByActionKey(items: any[], actionKey: string, statuses: string[]): any | null {
  return items.find((item) => item.action_key === actionKey && statuses.includes(item.status)) ?? null;
}

function mergeIntoExisting(existing: any, candidate: PmActionCandidate, reopen = false): Record<string, unknown> {
  const signalCount = (existing.signal_count ?? 1) + 1;
  const mergedEventIds = uniqueStrings([...(existing.source_event_ids ?? []), ...candidate.source_event_ids]);
  const mergedTaskIds = uniqueStrings([...(existing.related_clickup_task_ids ?? []), ...candidate.related_clickup_task_ids]);
  const mergedTaskTitles = uniqueStrings([...(existing.related_clickup_task_titles ?? []), ...candidate.related_clickup_task_titles]);
  const nextPriority = raisePriority(existing.priority ?? "high", candidate.is_escalation ? "urgent" : candidate.priority);
  const title = existing.title?.includes("Grant") ? existing.title : candidate.title;
  const description = mergeDescription(
    existing.description,
    candidate.blocked_actor_name ?? existing.blocked_actor_name,
    mergedTaskTitles[0] ?? null,
    candidate.last_signal_summary ?? candidate.description ?? "",
    candidate.is_escalation || signalCount > 1,
  );

  const patch: Record<string, unknown> = {
    title,
    description,
    priority: nextPriority,
    action_payload: { ...(existing.action_payload ?? {}), ...(candidate.action_payload ?? {}) },
    source_event_ids: mergedEventIds,
    related_clickup_task_ids: mergedTaskIds,
    related_clickup_task_titles: mergedTaskTitles,
    signal_count: signalCount,
    latest_signal_at: candidate.signal_at,
    last_signal_summary: candidate.last_signal_summary,
    blocker_resource: candidate.blocker_resource ?? existing.blocker_resource,
    blocked_actor_name: candidate.blocked_actor_name ?? existing.blocked_actor_name,
    blocked_actor_email: candidate.blocked_actor_email ?? existing.blocked_actor_email,
    execution_status: "ready",
    execution_error: null,
  };

  if (reopen) {
    patch.status = "open";
    patch.completed_at = null;
    patch.executed_at = null;
    patch.execution_result = { reopened: true, reopened_at: candidate.signal_at };
    patch.resolution_note = null;
  }

  return patch;
}

function candidateToUpsertInput(
  projectId: string,
  statusReportId: string,
  candidate: PmActionCandidate,
  createdBy: string,
): UpsertPmActionInput {
  const payload = { ...(candidate.action_payload ?? {}) };
  const actionKey = candidate.action_key ?? inferActionKeyForCandidate(projectId, candidate);
  const textForFamily =
    candidate.last_signal_summary ?? candidate.description ?? candidate.title ?? "";
  const actionFamily =
    (typeof payload.action_family === "string" ? payload.action_family : null) ??
    inferActionFamilyFromText(textForFamily);

  let actionIdentity =
    candidate.action_identity ??
    (typeof payload.action_identity === "string" ? payload.action_identity : null) ??
    actionKey;

  const channelId = typeof payload.slack_channel_id === "string" ? payload.slack_channel_id : null;
  const threadTs = typeof payload.slack_thread_ts === "string" ? payload.slack_thread_ts : null;
  if (channelId && threadTs) {
    actionIdentity = buildActionIdentityForSlackSignal({
      projectId,
      channelId,
      threadTs,
      signalType: candidate.signal_type ?? "general_action",
      text: textForFamily,
      actionFamily,
    });
  } else if (!actionIdentity) {
    actionIdentity = buildFallbackActionIdentity({
      sourceType: candidate.source_type ?? candidate.source,
      projectId,
      normalizedTitleOrKey: actionKey ?? candidate.title,
    });
  }

  payload.action_identity = actionIdentity;
  payload.action_family = actionFamily;

  return {
    project_id: projectId,
    status_report_id: statusReportId,
    title: candidate.title,
    description: candidate.description,
    category: candidate.category,
    priority: candidate.priority,
    source: candidate.source,
    source_type: normalizePmActionSourceType(candidate.source, candidate.source_type),
    source_message: candidate.last_signal_summary ?? candidate.description,
    source_thread_key: candidate.source_thread_key ?? null,
    action_type: candidate.action_type,
    action_payload: payload,
    action_key: actionKey,
    action_identity: actionIdentity,
    source_event_ids: candidate.source_event_ids,
    signal_type: candidate.signal_type ?? null,
    signal_at: candidate.signal_at,
    execution_status: candidate.execution_status,
    created_by: createdBy,
    is_escalation: candidate.is_escalation,
    source_metadata: {
      action_family: actionFamily,
      blocker_type: candidate.blocker_type,
      blocker_resource: candidate.blocker_resource,
    },
  };
}

export function aiActionOverlapsSlackTopic(candidate: PmActionCandidate, existingItems: any[]): boolean {
  const family = inferActionFamilyFromText(
    `${candidate.title} ${candidate.description ?? ""} ${candidate.last_signal_summary ?? ""}`,
  );
  if (!family || family === "work_request" || family === "slack_request") return false;
  return existingItems.some((item) => {
    const source = item.source_type ?? item.source;
    if (source !== "slack") return false;
    if (!["open", "done", "dismissed", "in_progress"].includes(item.status)) return false;
    const itemFamily = actionFamilyFromItem(item);
    return actionFamiliesEquivalent(itemFamily, family);
  });
}

export async function upsertPmActionItem(args: {
  supabase: any;
  projectId: string;
  statusReportId: string;
  candidate: PmActionCandidate;
  existingItems: any[];
  createdBy: string;
}): Promise<UpsertPmActionResult> {
  const actionKey = inferActionKeyForCandidate(args.projectId, args.candidate);
  const candidate = { ...args.candidate, action_key: actionKey };
  const input = candidateToUpsertInput(args.projectId, args.statusReportId, candidate, args.createdBy);

  const upsert = await upsertPmActionFromSignal({
    admin: args.supabase,
    input,
    existingItems: args.existingItems,
  });

  return {
    item: upsert.item ?? null,
    merged: upsert.outcome === "updated" || upsert.outcome === "reopened",
    reopened: upsert.outcome === "reopened",
    suppressed: upsert.outcome === "suppressed" || upsert.outcome === "duplicate_avoided",
    suppressionReason: upsert.suppression_reason,
  };
}

export function aiActionOverlapsExisting(candidate: PmActionCandidate, existingItems: any[], projectId: string): boolean {
  if (aiActionOverlapsSlackTopic(candidate, existingItems)) return true;
  const proposed = proposedFromCandidate({ ...candidate, action_key: inferActionKeyForCandidate(projectId, candidate) });
  const match = findExistingActionForSignal(existingItems, proposed);
  if (match.shouldSuppress) return true;
  if (match.kind === "open" || match.kind === "done" || match.kind === "dismissed") return true;

  const actionKey = proposed.action_key;
  if (actionKey) {
    const matchByKey = existingItems.some(
      (item) =>
        item.action_key === actionKey &&
        (item.status === "open" || item.status === "in_progress" || item.status === "done" || item.status === "dismissed"),
    );
    if (matchByKey) return true;
  }
  if (candidate.action_type === "request_access" || candidate.category === "access_needed") {
    const taskId = candidate.related_clickup_task_ids[0] ?? candidate.action_payload?.clickup_task_ids?.[0];
    const resource =
      candidate.blocker_resource ??
      extractResourceFromText(`${candidate.title} ${candidate.description ?? ""}`);
    return existingItems.some((item) => {
      if (item.action_type !== "request_access" && item.category !== "access_needed") return false;
      if (item.status !== "open" && item.status !== "in_progress") return false;
      const sameTask = taskId ? (item.related_clickup_task_ids ?? []).includes(taskId) : true;
      const sameResource = resource
        ? (item.blocker_resource ?? item.action_payload?.system_name) === resource
        : true;
      return sameTask && sameResource;
    });
  }
  return false;
}

export async function dedupeProjectPmActionItems(args: {
  supabase: any;
  projectId: string;
}): Promise<{ merged_groups: number; dismissed: string[] }> {
  const { data: items, error } = await args.supabase
    .from("project_pm_action_items")
    .select("*")
    .eq("project_id", args.projectId)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const openItems = items ?? [];
  const dismissed: string[] = [];
  const groups = new Map<string, any[]>();

  for (const item of openItems) {
    let key = item.action_key as string | null;
    if (!key && (item.action_type === "request_access" || item.category === "access_needed")) {
      key = buildAccessActionKey({
        projectId: args.projectId,
        clickupTaskId: item.related_clickup_task_ids?.[0] ?? item.action_payload?.clickup_task_ids?.[0] ?? null,
        actorName: item.blocked_actor_name,
        resource: item.blocker_resource ?? item.action_payload?.system_name ?? null,
      });
    }
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  let mergedGroups = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    mergedGroups += 1;
    const keeper = group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    const duplicates = group.filter((item) => item.id !== keeper.id);
    let signalCount = keeper.signal_count ?? 1;
    let latestSignalAt = keeper.latest_signal_at ?? keeper.created_at;
    let lastSummary = keeper.last_signal_summary;
    const mergedEventIds = [...(keeper.source_event_ids ?? [])];
    const mergedTaskIds = [...(keeper.related_clickup_task_ids ?? [])];
    const mergedTaskTitles = [...(keeper.related_clickup_task_titles ?? [])];

    for (const dup of duplicates) {
      signalCount += dup.signal_count ?? 1;
      if (dup.latest_signal_at && new Date(dup.latest_signal_at) > new Date(latestSignalAt)) {
        latestSignalAt = dup.latest_signal_at;
        lastSummary = dup.last_signal_summary;
      }
      mergedEventIds.push(...(dup.source_event_ids ?? []));
      mergedTaskIds.push(...(dup.related_clickup_task_ids ?? []));
      mergedTaskTitles.push(...(dup.related_clickup_task_titles ?? []));
      await args.supabase
        .from("project_pm_action_items")
        .update({
          status: "dismissed",
          resolution_note: `Merged into action ${keeper.id} during duplicate cleanup.`,
          execution_result: { merged_into: keeper.id },
        })
        .eq("id", dup.id);
      dismissed.push(dup.id);
    }

    await args.supabase
      .from("project_pm_action_items")
      .update({
        signal_count: signalCount,
        latest_signal_at: latestSignalAt,
        last_signal_summary: lastSummary,
        source_event_ids: uniqueStrings(mergedEventIds),
        related_clickup_task_ids: uniqueStrings(mergedTaskIds),
        related_clickup_task_titles: uniqueStrings(mergedTaskTitles),
        priority: raisePriority(keeper.priority ?? "high", "urgent"),
        action_key: keeper.action_key ?? inferActionKeyForCandidate(args.projectId, {
          ...keeper,
          related_clickup_task_ids: uniqueStrings(mergedTaskIds),
        } as PmActionCandidate),
      })
      .eq("id", keeper.id);
  }

  return { merged_groups: mergedGroups, dismissed };
}
