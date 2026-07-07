import {
  buildAccessActionKey,
  buildRequestFileActionKey,
  inferActionKeyForCandidate,
  normalizeSlug,
  type PmActionCandidate,
} from "./pmActionDedupe.ts";
import {
  extractTopicKeywords,
  topicKeywordsFromAction,
  topicKeywordsOverlap,
} from "./resolutionDetection.ts";
import type { ConversationGroup } from "./conversationState.ts";
import { findGroupForEvent } from "./conversationState.ts";

export function buildTopicSlugFromKeywords(keywords: string[]): string {
  if (keywords.length === 0) return "general-topic";
  return keywords.slice(0, 3).join("-");
}

export function inferRequestFileActionKey(args: {
  projectId: string;
  clickupTaskId: string | null;
  actorName: string | null;
  text: string;
}): string | null {
  const keywords = extractTopicKeywords(args.text);
  if (keywords.length === 0) return null;
  return buildRequestFileActionKey({
    projectId: args.projectId,
    clickupTaskId: args.clickupTaskId,
    actorName: args.actorName,
    topicSlug: buildTopicSlugFromKeywords(keywords),
  });
}

export function candidateMatchesResolvedGroup(
  candidate: PmActionCandidate,
  group: ConversationGroup,
  projectId: string,
): boolean {
  if (group.net_state !== "resolved_issue") return false;

  const taskId = candidate.related_clickup_task_ids[0] ?? null;
  if (group.clickup_task_id && taskId && group.clickup_task_id !== taskId) return false;

  const candidateKeywords = topicKeywordsFromAction({
    title: candidate.title,
    description: candidate.description,
    blocker_resource: candidate.blocker_resource,
    action_payload: candidate.action_payload,
    last_signal_summary: candidate.last_signal_summary,
  });

  if (group.topic_keywords.length > 0 && candidateKeywords.length > 0) {
    return topicKeywordsOverlap(group.topic_keywords, candidateKeywords);
  }

  const candidateKey = inferActionKeyForCandidate(projectId, candidate);
  const groupKey = inferRequestFileActionKey({
    projectId,
    clickupTaskId: group.clickup_task_id,
    actorName: group.events[0]?.actor_name ?? null,
    text: group.events.map((event) => event.comment_text).join(" "),
  });
  if (candidateKey && groupKey && candidateKey === groupKey) return true;

  return Boolean(group.clickup_task_id && taskId === group.clickup_task_id && group.topic_keywords.length > 0);
}

export function shouldSkipCandidateForConversationState(
  candidate: PmActionCandidate,
  groups: ConversationGroup[],
  projectId: string,
): boolean {
  for (const group of groups) {
    if (candidateMatchesResolvedGroup(candidate, group, projectId)) return true;
  }
  return false;
}

export function findMatchingOpenActionForGroup(
  group: ConversationGroup,
  items: any[],
  projectId: string,
): any | null {
  if (group.net_state !== "resolved_issue") return null;

  const openItems = items.filter((item) => item.status === "open" || item.status === "in_progress");
  const groupText = group.events.map((event) => event.comment_text).join(" ");
  const inferredKey = inferRequestFileActionKey({
    projectId,
    clickupTaskId: group.clickup_task_id,
    actorName: group.events.find((event) => event.request_signal)?.actor_name ?? group.events[0]?.actor_name ?? null,
    text: groupText,
  });

  if (inferredKey) {
    const exact = openItems.find((item) => item.action_key === inferredKey);
    if (exact) return exact;
  }

  for (const item of openItems) {
    const sameTask =
      !group.clickup_task_id ||
      (item.related_clickup_task_ids ?? []).includes(group.clickup_task_id) ||
      (item.action_payload?.clickup_task_ids ?? []).includes(group.clickup_task_id);
    if (!sameTask) continue;

    const itemKeywords = topicKeywordsFromAction(item);
    if (group.topic_keywords.length > 0 && topicKeywordsOverlap(group.topic_keywords, itemKeywords)) {
      return item;
    }

    if (
      group.clickup_task_id &&
      (item.action_type === "ask_client_question" ||
        item.action_type === "request_access" ||
        item.category === "access_needed" ||
        item.category === "client_question" ||
        /provide|sample|file|csv|access/i.test(`${item.title} ${item.description ?? ""}`))
    ) {
      return item;
    }
  }

  if (group.clickup_task_id) {
    const accessKey = buildAccessActionKey({
      projectId,
      clickupTaskId: group.clickup_task_id,
      actorName: group.events[0]?.actor_name ?? null,
      resource: group.topic_keywords[0] ?? null,
    });
    const accessMatch = openItems.find((item) => item.action_key === accessKey);
    if (accessMatch) return accessMatch;
  }

  return null;
}

export async function autoResolveActionsFromConversationGroups(args: {
  supabase: any;
  projectId: string;
  groups: ConversationGroup[];
  existingItems: any[];
  createdBy: string;
}): Promise<{ resolved: any[]; timeline_events: string[] }> {
  const resolved: any[] = [];
  const timelineEvents: string[] = [];
  const workingItems = [...args.existingItems];

  for (const group of args.groups) {
    if (group.net_state !== "resolved_issue") continue;

    const match = findMatchingOpenActionForGroup(group, workingItems, args.projectId);
    if (!match) continue;

    const now = new Date().toISOString();
    const reason =
      group.resolving_comment_text
        ? `Resolved because ClickUp comment said: "${group.resolving_comment_text.slice(0, 280)}"`
        : group.net_state_reason;

    const { data: updated, error } = await args.supabase
      .from("project_pm_action_items")
      .update({
        status: "done",
        execution_status: "succeeded",
        completed_at: now,
        executed_at: now,
        execution_error: null,
        resolution_note: reason,
        resolution_source: "clickup_signal",
        auto_resolved_by_event_id: group.resolving_event_id,
        auto_resolved_reason: reason,
        execution_result: {
          auto_resolved: true,
          resolving_event_id: group.resolving_event_id,
          conversation_group_id: group.group_id,
        },
      })
      .eq("id", match.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await args.supabase.from("project_pm_action_executions").insert({
      project_id: args.projectId,
      action_item_id: match.id,
      action_type: match.action_type,
      input_payload: {
        auto_resolve: true,
        conversation_group_id: group.group_id,
        resolving_event_id: group.resolving_event_id,
      },
      result_payload: {
        resolution_source: "clickup_signal",
        reason,
        resolving_comment_text: group.resolving_comment_text,
      },
      status: "succeeded",
      clickup_task_ids: match.related_clickup_task_ids ?? [],
      created_by: args.createdBy,
    });

    const summary = group.resolving_comment_text
      ? `The action was resolved because the developer said: "${group.resolving_comment_text.slice(0, 280)}"`
      : reason;

    const { data: timelineEvent } = await args.supabase
      .from("project_clickup_timeline_events")
      .insert({
        project_id: args.projectId,
        clickup_task_id: group.clickup_task_id,
        event_type: "pm_action_auto_resolved",
        event_title: "PM action auto-resolved",
        event_summary: summary,
        direction: "from_clickup",
        source: "oxus_action",
        raw_payload: {
          action_item_id: match.id,
          conversation_group_id: group.group_id,
          resolving_event_id: group.resolving_event_id,
          auto_resolved_reason: reason,
        },
      })
      .select("id")
      .single();

    if (timelineEvent?.id) timelineEvents.push(timelineEvent.id);

    resolved.push(updated);
    const idx = workingItems.findIndex((item) => item.id === match.id);
    if (idx >= 0) workingItems[idx] = updated;
  }

  return { resolved, timeline_events: timelineEvents };
}

export function filterBlockerSignalsForConversationState<T extends { source_event_id: string }>(
  signals: T[],
  groups: ConversationGroup[],
): T[] {
  return signals.filter((signal) => {
    const group = findGroupForEvent(groups, signal.source_event_id);
    if (!group || group.net_state !== "resolved_issue") return true;

    const resolvingEvent = group.resolving_event_id
      ? group.events.find((event) => event.id === group.resolving_event_id)
      : null;
    const signalEvent = group.events.find((event) => event.id === signal.source_event_id);
    if (!signalEvent || !resolvingEvent) return false;

    return new Date(signalEvent.created_at).getTime() > new Date(resolvingEvent.created_at).getTime();
  });
}
