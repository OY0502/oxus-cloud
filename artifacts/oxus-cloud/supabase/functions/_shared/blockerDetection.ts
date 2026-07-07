/** Deterministic blocker detection from ClickUp timeline / comment text. */

import {
  buildAccessBlockerTitle,
  buildAccessRequestCopy,
  extractResourceFromText,
  inferResourceFromExistingActions,
  isEscalationComment,
} from "./pmActionDedupe.ts";

export type BlockerSignal = {
  kind: "access_blocker" | "general_blocker";
  title: string;
  summary: string;
  priority: "high" | "urgent";
  category: "access_needed" | "general";
  action_type: "request_access" | "manual";
  source_event_id: string;
  clickup_task_id: string | null;
  task_title: string | null;
  comment_text: string;
  system_name: string | null;
  question_text: string;
  actor_name: string | null;
  actor_email: string | null;
  signal_at: string;
  is_escalation: boolean;
};

const ACCESS_PATTERNS: RegExp[] = [
  /\bi\s+don'?t\s+have\s+access\b/i,
  /\bi\s+do\s+not\s+have\s+access\b/i,
  /\bcan'?t\s+access\b/i,
  /\bcannot\s+access\b/i,
  /\bno\s+access\b/i,
  /\bwaiting\s+for\s+access\b/i,
  /\bneed\s+access\b/i,
  /\bmissing\s+credentials\b/i,
  /\bcredentials\s+don'?t\s+work\b/i,
  /\blogin\s+doesn'?t\s+work\b/i,
  /\bpermission\s+denied\b/i,
  /\bnot\s+invited\b/i,
  /\bneed\s+invite\b/i,
  /\bi\s+need\s+access\s+to\b/i,
  /\bi\s+don'?t\s+have\s+permission\b/i,
];

const GENERAL_BLOCKER_PATTERNS: RegExp[] = [
  /\bblocked\s+by\b/i,
  /\bi\s+am\s+blocked\b/i,
  /\bblocked\b/i,
];

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function detectFromText(args: {
  text: string;
  sourceEventId: string;
  clickupTaskId: string | null;
  taskTitle: string | null;
  actorName: string | null;
  actorEmail: string | null;
  signalAt: string;
  existingItems: any[];
}): BlockerSignal | null {
  const text = normalizeText(args.text);
  if (!text) return null;

  const isAccess = ACCESS_PATTERNS.some((p) => p.test(text));
  const isGeneralBlocker = !isAccess && GENERAL_BLOCKER_PATTERNS.some((p) => p.test(text));
  if (!isAccess && !isGeneralBlocker) return null;

  const isEscalation = isEscalationComment(text);
  let systemName = isAccess ? extractResourceFromText(text) : null;
  if (isAccess && !systemName) {
    systemName = inferResourceFromExistingActions(args.existingItems, args.clickupTaskId, args.actorName);
  }

  const summary = isAccess
    ? systemName
      ? `${args.actorName ?? "Developer"} does not have access to ${systemName}.`
      : `${args.actorName ?? "Developer"} reported missing access: "${text.slice(0, 200)}"`
    : `Blocker reported: "${text.slice(0, 200)}"`;

  const title = isAccess
    ? buildAccessBlockerTitle(systemName, args.actorName)
    : "Review blocker";

  return {
    kind: isAccess ? "access_blocker" : "general_blocker",
    title,
    summary,
    priority: isEscalation ? "urgent" : "high",
    category: isAccess ? "access_needed" : "general",
    action_type: isAccess ? "request_access" : "manual",
    source_event_id: args.sourceEventId,
    clickup_task_id: args.clickupTaskId,
    task_title: args.taskTitle,
    comment_text: text,
    system_name: systemName,
    question_text: buildAccessRequestCopy({
      resource: systemName,
      actorName: args.actorName,
      taskTitle: args.taskTitle,
    }),
    actor_name: args.actorName,
    actor_email: args.actorEmail,
    signal_at: args.signalAt,
    is_escalation: isEscalation,
  };
}

export function detectBlockersFromTimelineEvent(
  event: {
    id: string;
    event_type?: string | null;
    event_summary?: string | null;
    clickup_task_id?: string | null;
    actor_name?: string | null;
    actor_email?: string | null;
    created_at?: string;
    raw_payload?: unknown;
  },
  taskMeta?: { name?: string | null; url?: string | null },
  existingItems: any[] = [],
): BlockerSignal | null {
  const eventType = event.event_type ?? "";
  const isCommentEvent =
    eventType === "taskCommentPosted" ||
    eventType === "taskCommentUpdated" ||
    eventType.includes("comment");

  const payload = (event.raw_payload ?? {}) as Record<string, unknown>;
  const payloadText =
    typeof payload.comment_text === "string"
      ? payload.comment_text
      : typeof payload.extracted_comment_text === "string"
        ? payload.extracted_comment_text
        : null;

  const texts = [payloadText, event.event_summary].filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  if (isCommentEvent || texts.some((t) => ACCESS_PATTERNS.some((p) => p.test(t)))) {
    for (const text of texts) {
      const signal = detectFromText({
        text,
        sourceEventId: event.id,
        clickupTaskId: event.clickup_task_id ?? null,
        taskTitle: taskMeta?.name ?? null,
        actorName: event.actor_name ?? null,
        actorEmail: event.actor_email ?? null,
        signalAt: event.created_at ?? new Date().toISOString(),
        existingItems,
      });
      if (signal) return signal;
    }
  }

  return null;
}

export function detectBlockersFromTimeline(
  events: Array<{
    id: string;
    event_type?: string | null;
    event_summary?: string | null;
    clickup_task_id?: string | null;
    actor_name?: string | null;
    actor_email?: string | null;
    created_at?: string;
    raw_payload?: unknown;
  }>,
  taskLinks: Array<{ clickup_task_id: string; clickup_task_name?: string | null; clickup_task_url?: string | null }>,
  existingItems: any[] = [],
): BlockerSignal[] {
  const taskById = new Map(
    taskLinks.map((t) => [t.clickup_task_id, { name: t.clickup_task_name, url: t.clickup_task_url }]),
  );
  const signals: BlockerSignal[] = [];
  const seenEvents = new Set<string>();

  for (const event of events) {
    const meta = event.clickup_task_id ? taskById.get(event.clickup_task_id) : undefined;
    const signal = detectBlockersFromTimelineEvent(event, meta, existingItems);
    if (!signal) continue;
    if (seenEvents.has(signal.source_event_id)) continue;
    seenEvents.add(signal.source_event_id);
    signals.push(signal);
  }

  return signals;
}

export function blockerSignalToPmAction(signal: BlockerSignal) {
  return {
    title: signal.title,
    description: signal.summary,
    category: signal.category,
    priority: signal.priority,
    action_type: signal.action_type,
    action_payload: {
      clickup_task_ids: signal.clickup_task_id ? [signal.clickup_task_id] : [],
      question_text: signal.question_text,
      system_name: signal.system_name,
      comment_text: signal.comment_text,
      blocker_kind: signal.kind,
    },
    source_event_ids: [signal.source_event_id],
    execution_status: "ready" as const,
  };
}
