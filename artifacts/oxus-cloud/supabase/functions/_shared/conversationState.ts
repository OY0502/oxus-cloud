/** Group ClickUp comment timeline events and derive net conversation state. */

import {
  detectRequestSignal,
  detectResolutionSignal,
  extractTopicKeywords,
  type RequestSignal,
  type ResolutionSignal,
} from "./resolutionDetection.ts";
import { isEscalationComment } from "./pmActionDedupe.ts";
import { extractCommentTextFromTimelineEvent, type CommentMetadata } from "./clickupComments.ts";

export type ConversationNetState = "open_issue" | "resolved_issue" | "informational" | "unclear";

export type NormalizedCommentEvent = {
  id: string;
  clickup_task_id: string | null;
  clickup_comment_id: string | null;
  clickup_parent_comment_id: string | null;
  clickup_thread_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  comment_text: string;
  created_at: string;
  event_type: string;
  request_signal: RequestSignal | null;
  resolution_signal: ResolutionSignal | null;
};

export type ConversationGroup = {
  group_id: string;
  clickup_task_id: string | null;
  clickup_thread_id: string | null;
  task_title: string | null;
  events: NormalizedCommentEvent[];
  net_state: ConversationNetState;
  net_state_reason: string;
  topic_keywords: string[];
  latest_comment_text: string;
  latest_event_id: string;
  resolving_event_id: string | null;
  resolving_comment_text: string | null;
};

function eventTimestamp(event: { clickup_date?: string | null; created_at?: string }): string {
  return event.clickup_date ?? event.created_at ?? new Date().toISOString();
}

function isCommentTimelineEvent(event: { event_type?: string | null }): boolean {
  const type = event.event_type ?? "";
  return type === "taskCommentPosted" || type === "taskCommentUpdated" || type.includes("comment");
}

export function normalizeCommentTimelineEvent(event: any): NormalizedCommentEvent | null {
  if (!isCommentTimelineEvent(event)) return null;
  const commentText = extractCommentTextFromTimelineEvent(event);
  if (!commentText) return null;

  const metadata: CommentMetadata = {
    clickup_comment_id: event.clickup_comment_id ?? null,
    clickup_parent_comment_id: event.clickup_parent_comment_id ?? null,
    clickup_thread_id: event.clickup_thread_id ?? null,
  };

  return {
    id: event.id,
    clickup_task_id: event.clickup_task_id ?? null,
    clickup_comment_id: metadata.clickup_comment_id,
    clickup_parent_comment_id: metadata.clickup_parent_comment_id,
    clickup_thread_id: metadata.clickup_thread_id,
    actor_name: event.actor_name ?? null,
    actor_email: event.actor_email ?? null,
    comment_text: commentText,
    created_at: eventTimestamp(event),
    event_type: event.event_type ?? "taskCommentPosted",
    request_signal: detectRequestSignal(commentText),
    resolution_signal: detectResolutionSignal(commentText),
  };
}

function groupKeyForEvent(event: NormalizedCommentEvent): string {
  if (event.clickup_thread_id) return `thread:${event.clickup_thread_id}`;
  if (event.clickup_parent_comment_id) return `parent:${event.clickup_parent_comment_id}`;
  if (event.clickup_task_id) {
    const actor = (event.actor_name ?? event.actor_email ?? "unknown").toLowerCase();
    return `task:${event.clickup_task_id}:${actor}`;
  }
  return `event:${event.id}`;
}

function deriveNetState(events: NormalizedCommentEvent[]): {
  net_state: ConversationNetState;
  net_state_reason: string;
  resolving_event_id: string | null;
  resolving_comment_text: string | null;
} {
  const sorted = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let lastRequest: { event: NormalizedCommentEvent; at: number } | null = null;
  let lastResolution: { event: NormalizedCommentEvent; at: number } | null = null;
  let escalatedAfterResolution = false;

  for (const event of sorted) {
    const at = new Date(event.created_at).getTime();
    const text = event.comment_text;

    if (event.request_signal) {
      lastRequest = { event, at };
    }

    if (event.resolution_signal) {
      lastResolution = { event, at };
      escalatedAfterResolution = false;
      continue;
    }

    if (lastResolution && isEscalationComment(text)) {
      escalatedAfterResolution = true;
      lastRequest = { event, at };
    }
  }

  if (lastResolution && lastRequest) {
    if (lastResolution.at >= lastRequest.at && !escalatedAfterResolution) {
      return {
        net_state: "resolved_issue",
        net_state_reason: lastResolution.event.resolution_signal?.reason ?? "A later comment indicates the issue was resolved.",
        resolving_event_id: lastResolution.event.id,
        resolving_comment_text: lastResolution.event.comment_text,
      };
    }
    return {
      net_state: escalatedAfterResolution ? "open_issue" : "open_issue",
      net_state_reason: escalatedAfterResolution
        ? "A later comment escalates the issue after an earlier resolution signal."
        : lastRequest.event.request_signal?.reason ?? "An unresolved request remains open in this thread.",
      resolving_event_id: null,
      resolving_comment_text: null,
    };
  }

  if (lastResolution) {
    return {
      net_state: "resolved_issue",
      net_state_reason: lastResolution.event.resolution_signal?.reason ?? "Resolution signal detected.",
      resolving_event_id: lastResolution.event.id,
      resolving_comment_text: lastResolution.event.comment_text,
    };
  }

  if (lastRequest) {
    return {
      net_state: "open_issue",
      net_state_reason: lastRequest.event.request_signal?.reason ?? "Open request detected.",
      resolving_event_id: null,
      resolving_comment_text: null,
    };
  }

  return {
    net_state: sorted.length > 0 ? "informational" : "unclear",
    net_state_reason: sorted.length > 0 ? "No request or resolution signal detected." : "No comment events in group.",
    resolving_event_id: null,
    resolving_comment_text: null,
  };
}

export function buildConversationGroups(
  events: any[],
  taskLinks: Array<{ clickup_task_id: string; clickup_task_name?: string | null }> = [],
): ConversationGroup[] {
  const taskNameById = new Map(
    taskLinks.map((task) => [task.clickup_task_id, task.clickup_task_name ?? null]),
  );

  const normalized = events
    .map((event) => normalizeCommentTimelineEvent(event))
    .filter((event): event is NormalizedCommentEvent => event !== null);

  const buckets = new Map<string, NormalizedCommentEvent[]>();
  for (const event of normalized) {
    const key = groupKeyForEvent(event);
    const bucket = buckets.get(key) ?? [];
    bucket.push(event);
    buckets.set(key, bucket);
  }

  const groups: ConversationGroup[] = [];
  for (const [group_id, groupEvents] of buckets) {
    const sorted = [...groupEvents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const latest = sorted[sorted.length - 1];
    const taskId = latest.clickup_task_id;
    const { net_state, net_state_reason, resolving_event_id, resolving_comment_text } = deriveNetState(sorted);
    const topic_keywords = [...new Set(sorted.flatMap((event) => extractTopicKeywords(event.comment_text)))];

    groups.push({
      group_id,
      clickup_task_id: taskId,
      clickup_thread_id: latest.clickup_thread_id,
      task_title: taskId ? taskNameById.get(taskId) ?? null : null,
      events: sorted,
      net_state,
      net_state_reason,
      topic_keywords,
      latest_comment_text: latest.comment_text,
      latest_event_id: latest.id,
      resolving_event_id,
      resolving_comment_text,
    });
  }

  return groups.sort((a, b) => new Date(b.events[b.events.length - 1].created_at).getTime() - new Date(a.events[a.events.length - 1].created_at).getTime());
}

export function groupContainsEventId(group: ConversationGroup, eventId: string): boolean {
  return group.events.some((event) => event.id === eventId);
}

export function isEventInResolvedGroup(groups: ConversationGroup[], eventId: string): boolean {
  return groups.some((group) => group.net_state === "resolved_issue" && groupContainsEventId(group, eventId));
}

export function findGroupForEvent(groups: ConversationGroup[], eventId: string): ConversationGroup | null {
  return groups.find((group) => groupContainsEventId(group, eventId)) ?? null;
}
