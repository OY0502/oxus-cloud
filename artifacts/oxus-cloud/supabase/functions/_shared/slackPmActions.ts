import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildSlackThreadKey } from "./projectSignalPipeline.ts";
import {
  findExistingActionForSignal,
  proposedFromCandidate,
  suppressionReasonFromMatch,
  type SuppressionReason,
} from "./pmActionSuppression.ts";
import { buildActionIdentityForSlackSignal } from "./pmActionIdentity.ts";
import {
  loadProjectPmActionsForUpsert,
  upsertPmActionFromSignal,
  type UpsertPmActionInput,
} from "./pmActionUpsert.ts";
import { isMeaningfulSlackSignal } from "./slackSignalClassification.ts";
import {
  buildTaskDraftFromSlackSignal,
  loadClickupMembersForProject,
} from "./slackTaskDraft.ts";
import {
  createPmActionResolvedTimelineEvent,
  syncSlackSignalToTimeline,
  upsertSlackThreadUpdateTimelineEvent,
} from "./projectTimelineEvents.ts";
import {
  analyzeSlackThreadScheduling,
  slackEventToThreadMessage,
  type SlackThreadSchedulingState,
} from "./slackThreadScheduling.ts";

export type SlackPmProcessResult = {
  threads_checked: number;
  actions_created: number;
  actions_updated: number;
  actions_auto_resolved: number;
  actions_suppressed: number;
  timeline_events_created: number;
  timeline_events_updated: number;
  duplicates_avoided: number;
  reasons: string[];
  suppression_reasons: SuppressionReason[];
};

type DbSlackEvent = {
  id: string;
  project_id: string;
  slack_team_id: string;
  slack_channel_id: string;
  slack_ts: string;
  slack_thread_ts: string | null;
  slack_user_name: string | null;
  message_text: string | null;
  message_preview: string | null;
  link_type: string | null;
  is_client_facing: boolean | null;
  raw_payload?: Record<string, unknown>;
  project_slack_link_id?: string | null;
};

type PmActionRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  action_key: string | null;
  action_payload: Record<string, unknown>;
  change_history: unknown[];
  signal_count: number;
  source_thread_key?: string | null;
  source_type?: string | null;
  execution_status?: string | null;
  resolution_source?: string | null;
  dismissed_at?: string | null;
  completed_at?: string | null;
  suppressed_signal_count?: number;
};

const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

function raisePriority(current: string, next: string): string {
  return (PRIORITY_RANK[next] ?? 2) > (PRIORITY_RANK[current] ?? 2) ? next : current;
}

function slackTsToIso(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

async function loadProjectPmActions(
  admin: SupabaseClient,
  projectId: string,
): Promise<PmActionRow[]> {
  const rows = await loadProjectPmActionsForUpsert(admin, projectId);
  return rows as PmActionRow[];
}

async function findThreadPmAction(
  admin: SupabaseClient,
  projectId: string,
  threadKey: string,
  actionKey: string,
  existingItems?: PmActionRow[],
): Promise<PmActionRow | null> {
  const items = existingItems ?? (await loadProjectPmActions(admin, projectId));

  const proposed = proposedFromCandidate({
    action_key: actionKey,
    source_thread_key: threadKey,
    source_type: "slack",
    signal_type: "meeting_needed",
    action_payload: { slack_thread_key: threadKey, signal_type: "meeting_needed" },
  });
  const match = findExistingActionForSignal(items as Record<string, unknown>[], proposed);
  if (match.item) return match.item as PmActionRow;

  for (const row of items) {
    const payload = row.action_payload ?? {};
    if (payload.slack_thread_key === threadKey || row.action_key === actionKey) {
      return row;
    }
  }
  return null;
}

function appendChangeHistory(
  existing: unknown[],
  entry: Record<string, unknown>,
): Record<string, unknown>[] {
  return [...(Array.isArray(existing) ? existing : []), entry];
}

async function autoResolveMeetingAction(args: {
  admin: SupabaseClient;
  projectId: string;
  action: PmActionRow;
  threadKey: string;
  state: SlackThreadSchedulingState;
}): Promise<void> {
  const now = new Date().toISOString();
  await args.admin
    .from("project_pm_action_items")
    .update({
      status: "done",
      completed_at: now,
      execution_status: "succeeded",
      executed_at: now,
      resolution_source: "slack_signal",
      auto_resolved_reason: "Slack thread indicates the meeting has been scheduled.",
      latest_signal_at: now,
      last_signal_summary: args.state.latestRelevantMessage.slice(0, 200),
    })
    .eq("id", args.action.id);

  await args.admin
    .from("project_signal_threads")
    .update({ current_state: "resolved", updated_at: now })
    .eq("project_id", args.projectId)
    .eq("thread_key", args.threadKey);

  await createPmActionResolvedTimelineEvent({
    admin: args.admin,
    projectId: args.projectId,
    actionId: args.action.id,
    title: "Meeting scheduling action resolved",
    summary: "Slack thread indicates the meeting has been scheduled.",
    threadKey: args.threadKey,
  });
}

async function upsertMeetingPmAction(args: {
  admin: SupabaseClient;
  projectId: string;
  threadKey: string;
  state: SlackThreadSchedulingState;
  channelId: string;
  channelName: string | null;
  linkType: string | null;
  createdBy?: string | null;
  existingItems: PmActionRow[];
  sourceSignalIds?: string[];
}): Promise<{
  created: boolean;
  updated: boolean;
  actionId: string | null;
  duplicateAvoided: boolean;
  suppressed: boolean;
  suppressionReason?: SuppressionReason;
  workingItems: PmActionRow[];
}> {
  const threadRootTs = args.state.originalTs ?? args.state.latestTs ?? "";
  const actionIdentity = buildActionIdentityForSlackSignal({
    projectId: args.projectId,
    channelId: args.channelId,
    threadTs: threadRootTs,
    signalType: "meeting_needed",
    text: args.state.latestRelevantMessage,
    actionFamily: "client_meeting",
  });

  const input: UpsertPmActionInput = {
    project_id: args.projectId,
    title: args.state.title,
    description: args.state.description,
    category: "general",
    priority: "medium",
    source: "slack",
    source_type: "slack",
    source_app: "Slack",
    source_label: args.channelName ? `#${args.channelName}` : args.channelId,
    source_actor_name: args.state.latestActor,
    source_message: args.state.latestRelevantMessage,
    source_message_ts: slackTsToIso(args.state.latestTs),
    source_thread_key: args.threadKey,
    source_external_id: `${args.channelId}:${threadRootTs}`,
    source_metadata: {
      channel_name: args.channelName,
      link_type: args.linkType,
      slack_ts: args.state.latestTs,
      slack_thread_ts: args.state.originalTs,
      original_message: args.state.originalMessage,
      meeting_date_text: args.state.currentMeetingDate,
      previous_meeting_date_text: args.state.previousMeetingDate,
    },
    action_type: "manual",
    action_payload: {
      source: "slack",
      signal_type: "meeting_needed",
      meeting_date_text: args.state.currentMeetingDate,
      previous_meeting_date_text: args.state.previousMeetingDate,
      slack_thread_key: args.threadKey,
      original_message: args.state.originalMessage,
      latest_relevant_message: args.state.latestRelevantMessage,
      slack_channel_id: args.channelId,
      slack_thread_ts: threadRootTs,
      action_identity: actionIdentity,
    },
    action_key: args.state.actionKey,
    action_identity: actionIdentity,
    source_signal_ids: args.sourceSignalIds ?? [],
    signal_type: "meeting_needed",
    signal_at: new Date().toISOString(),
    execution_status: "not_started",
    created_by: args.createdBy ?? null,
  };

  const upsert = await upsertPmActionFromSignal({
    admin: args.admin,
    input,
    existingItems: args.existingItems as Record<string, unknown>[],
  });

  return {
    created: upsert.outcome === "created",
    updated: upsert.outcome === "updated" || upsert.outcome === "reopened",
    actionId: upsert.action_id,
    duplicateAvoided: upsert.outcome === "duplicate_avoided" || upsert.outcome === "updated",
    suppressed: upsert.outcome === "suppressed",
    suppressionReason: upsert.suppression_reason,
    workingItems: upsert.workingItems as PmActionRow[],
  };
}

async function upsertGeneralSlackSignalAction(args: {
  admin: SupabaseClient;
  projectId: string;
  signal: Record<string, unknown>;
  channelName: string | null;
  linkType: string | null;
  createdBy?: string | null;
  existingItems: PmActionRow[];
}): Promise<{
  outcome: string;
  actionId: string | null;
  suppressed: boolean;
  suppressionReason?: SuppressionReason;
  workingItems: PmActionRow[];
}> {
  const metadata = (args.signal.metadata ?? {}) as Record<string, unknown>;
  const channelId = String(metadata.slack_channel_id ?? "");
  const threadTs = String(metadata.slack_thread_ts ?? metadata.slack_ts ?? "");
  const threadKey = typeof args.signal.thread_key === "string" ? args.signal.thread_key : "";
  const signalType = String(args.signal.signal_type ?? "general_action");
  const body = typeof args.signal.body === "string" ? args.signal.body : "";
  const actionFamily = typeof metadata.action_family === "string" ? metadata.action_family : null;
  const suggestedActionType =
    typeof metadata.suggested_action_type === "string"
      ? metadata.suggested_action_type
      : typeof metadata.suggested_clickup_task === "boolean" && metadata.suggested_clickup_task
      ? "create_clickup_task"
      : null;
  const actorClassification =
    typeof metadata.actor_classification === "string" ? metadata.actor_classification : null;

  const actionIdentity = buildActionIdentityForSlackSignal({
    projectId: args.projectId,
    channelId,
    threadTs,
    signalType,
    text: body,
    actionFamily,
  });

  let description = typeof args.signal.summary === "string" ? args.signal.summary : body.slice(0, 300);
  const actorName = typeof args.signal.actor_name === "string" ? args.signal.actor_name.trim() : null;
  const attachments = metadata.attachments;

  const clickupMembers = await loadClickupMembersForProject(args.admin, args.projectId);
  const taskDraft = buildTaskDraftFromSlackSignal({
    text: body,
    action_family: actionFamily,
    channel_name: args.channelName,
    source_label: args.channelName ? `#${args.channelName}` : channelId,
    actor_name: actorName,
    message_ts: typeof args.signal.source_created_at === "string" ? args.signal.source_created_at : null,
    clickup_members: clickupMembers,
    attachments: Array.isArray(attachments) ? attachments : undefined,
  });

  if (actionFamily === "header_logo_update") {
    description = taskDraft.description.split("\n\n")[0] ?? description;
    if (Array.isArray(attachments) && attachments.length > 0) {
      description += " The message included an attachment that may be the requested logo asset.";
    }
  } else if (actionFamily === "mixpanel_header_snippet") {
    description = taskDraft.description.split("\n\n")[0] ?? description;
  } else if (actionFamily === "weekly_update") {
    description = taskDraft.description.split("\n\n")[0] ?? description;
  } else if (Array.isArray(attachments) && attachments.length > 0) {
    description += " The message included an attachment that may be the requested asset.";
  }

  const isClickupTaskCandidate =
    signalType === "general_action" ||
    suggestedActionType === "create_clickup_task" ||
    actionFamily === "weekly_update" ||
    (actorClassification === "internal" &&
      /\b(?:add|implement|fix|update|change|replace|send|prepare)\b/i.test(body)) ||
    /\bweekly\s+update\b/i.test(body);

  const actionTitle = isClickupTaskCandidate
    ? taskDraft.title
    : typeof args.signal.title === "string"
    ? args.signal.title
    : "Review Slack work request";
  const actionPriority = raisePriority(
    typeof args.signal.priority === "string" ? args.signal.priority : "medium",
    taskDraft.priority,
  );

  const input: UpsertPmActionInput = {
    project_id: args.projectId,
    title: actionTitle,
    description,
    category: signalType === "client_question" && !isClickupTaskCandidate ? "client_question" : "general",
    priority: actionPriority,
    source: "slack",
    source_type: "slack",
    source_app: "Slack",
    source_label: args.channelName ? `#${args.channelName}` : channelId,
    source_actor_name: typeof args.signal.actor_name === "string" ? args.signal.actor_name : null,
    source_message: body,
    source_message_ts: typeof args.signal.source_created_at === "string" ? args.signal.source_created_at : null,
    source_thread_key: threadKey,
    source_external_id: typeof args.signal.external_id === "string" ? args.signal.external_id : null,
    source_metadata: {
      channel_name: args.channelName,
      link_type: args.linkType,
      attachments: metadata.attachments,
      action_family: actionFamily,
      actor_classification: actorClassification,
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
    },
    action_type: isClickupTaskCandidate ? "create_clickup_task" : "manual",
    action_payload: {
      source: "slack",
      signal_type: signalType,
      suggested_clickup_task: isClickupTaskCandidate,
      suggested_action_type: isClickupTaskCandidate ? "create_clickup_task" : suggestedActionType ?? "manual",
      suggested_task_title: taskDraft.title,
      suggested_task_description: taskDraft.description,
      action_family: actionFamily,
      slack_thread_key: threadKey,
      slack_channel_id: channelId,
      slack_thread_ts: threadTs,
      action_identity: actionIdentity,
      source_signal_ids: [String(args.signal.id)],
    },
    action_key: typeof args.signal.action_key === "string" ? args.signal.action_key : null,
    action_identity: actionIdentity,
    source_signal_ids: [String(args.signal.id)],
    signal_type: signalType,
    signal_at: new Date().toISOString(),
    execution_status: "not_started",
    created_by: args.createdBy ?? null,
    suggested_task_title: isClickupTaskCandidate ? taskDraft.title : null,
    suggested_task_description: isClickupTaskCandidate ? taskDraft.description : null,
    suggested_assignee_names: taskDraft.assignee_names,
    suggested_clickup_assignee_ids: taskDraft.suggested_clickup_assignee_ids,
    suggested_due_date: taskDraft.due_date ?? null,
    suggested_due_date_text: taskDraft.due_date_text ?? null,
    suggested_priority: taskDraft.priority,
    task_draft_metadata: {
      confidence: taskDraft.confidence,
      reasoning: taskDraft.reasoning,
      assignee_match_ambiguous: taskDraft.assignee_names.filter(
        (name) =>
          !taskDraft.suggested_clickup_assignee_ids.length &&
          taskDraft.assignee_names.includes(name),
      ),
    },
  };

  const upsert = await upsertPmActionFromSignal({
    admin: args.admin,
    input,
    existingItems: args.existingItems as Record<string, unknown>[],
  });

  return {
    outcome: upsert.reason,
    actionId: upsert.action_id,
    suppressed: upsert.outcome === "suppressed",
    suppressionReason: upsert.suppression_reason,
    workingItems: upsert.workingItems as PmActionRow[],
  };
}

export async function processSlackThreadIntelligenceForProject(args: {
  admin: SupabaseClient;
  projectId: string;
  createdBy?: string | null;
}): Promise<SlackPmProcessResult> {
  const result: SlackPmProcessResult = {
    threads_checked: 0,
    actions_created: 0,
    actions_updated: 0,
    actions_auto_resolved: 0,
    actions_suppressed: 0,
    timeline_events_created: 0,
    timeline_events_updated: 0,
    duplicates_avoided: 0,
    reasons: [],
    suppression_reasons: [],
  };

  const { data: links } = await args.admin
    .from("project_slack_links")
    .select("id, channel_name, link_type, slack_channel_id")
    .eq("project_id", args.projectId)
    .eq("status", "active");

  const channelMeta = new Map<string, { name: string | null; linkType: string | null }>();
  for (const link of links ?? []) {
    channelMeta.set(link.slack_channel_id, {
      name: link.channel_name ?? null,
      linkType: link.link_type ?? null,
    });
  }

  const { data: events, error } = await args.admin
    .from("project_slack_events")
    .select("*")
    .eq("project_id", args.projectId)
    .order("slack_ts", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  if (!events || events.length === 0) {
    result.reasons.push("no_slack_events");
    return result;
  }

  const existingItems = await loadProjectPmActions(args.admin, args.projectId);
  let workingItems = existingItems;

  const threads = new Map<string, DbSlackEvent[]>();
  for (const raw of events as DbSlackEvent[]) {
    const threadKey = buildSlackThreadKey(
      raw.slack_team_id,
      raw.slack_channel_id,
      raw.slack_thread_ts,
      raw.slack_ts,
    );
    const list = threads.get(threadKey) ?? [];
    list.push(raw);
    threads.set(threadKey, list);
  }

  for (const [threadKey, threadEvents] of threads) {
    result.threads_checked++;
    const messages = threadEvents
      .map((event) => slackEventToThreadMessage(event as unknown as Record<string, unknown>))
      .filter((message): message is NonNullable<typeof message> => message !== null);
    const state = analyzeSlackThreadScheduling({
      threadKey,
      messages,
      projectId: args.projectId,
      channelId: threadEvents[0].slack_channel_id,
    });
    if (!state) continue;

    const firstEvent = threadEvents[0];
    const meta = channelMeta.get(firstEvent.slack_channel_id) ?? { name: null, linkType: firstEvent.link_type };
    const channelName = meta.name;
    const linkType = meta.linkType ?? firstEvent.link_type;

    const existing = await findThreadPmAction(
      args.admin,
      args.projectId,
      threadKey,
      state.actionKey,
      existingItems,
    );

    if (state.isResolved) {
      if (existing && (existing.status === "open" || existing.status === "in_progress")) {
        await autoResolveMeetingAction({
          admin: args.admin,
          projectId: args.projectId,
          action: existing,
          threadKey,
          state,
        });
        result.actions_auto_resolved++;
        result.reasons.push(`auto_resolved:${threadKey.slice(-12)}`);
      }
      continue;
    }

    const upsert = await upsertMeetingPmAction({
      admin: args.admin,
      projectId: args.projectId,
      threadKey,
      state,
      channelId: firstEvent.slack_channel_id,
      channelName,
      linkType,
      createdBy: args.createdBy,
      existingItems: workingItems,
    });
    workingItems = upsert.workingItems;

    if (upsert.suppressed) {
      result.actions_suppressed++;
      result.reasons.push(`suppressed:${threadKey.slice(-12)}`);
      if (upsert.suppressionReason) {
        result.suppression_reasons.push(upsert.suppressionReason);
      }
      await args.admin
        .from("project_signal_threads")
        .update({ current_state: "ignored", updated_at: new Date().toISOString() })
        .eq("project_id", args.projectId)
        .eq("thread_key", threadKey);
      continue;
    }

    if (!upsert.actionId) continue;

    if (upsert.created) {
      result.actions_created++;
      result.reasons.push(`created_meeting:${threadKey.slice(-12)}`);
    } else if (upsert.updated) {
      result.actions_updated++;
      result.duplicates_avoided++;
      result.reasons.push(`updated_meeting:${threadKey.slice(-12)}`);
    } else if (upsert.duplicateAvoided) {
      result.duplicates_avoided++;
      result.reasons.push(`duplicate_avoided:${threadKey.slice(-12)}`);
    }

    const timelineTitle = state.previousMeetingDate
      ? "Meeting date updated in Slack thread"
      : "Meeting needs scheduling";
    const timelineSummary = state.previousMeetingDate
      ? `Meeting scheduling moved from ${state.previousMeetingDate} to ${state.currentMeetingDate ?? "a new date"}.`
      : state.description;

    const timeline = await upsertSlackThreadUpdateTimelineEvent({
      admin: args.admin,
      projectId: args.projectId,
      threadKey,
      eventTitle: timelineTitle,
      eventSummary: timelineSummary,
      eventBody: state.latestRelevantMessage,
      actorName: state.latestActor,
      sourceCreatedAt: slackTsToIso(state.latestTs),
      signalType: "meeting_needed",
      relatedPmActionItemId: upsert.actionId,
      channelId: firstEvent.slack_channel_id,
      channelName,
      linkType,
      metadata: {
        meeting_date_text: state.currentMeetingDate,
        previous_meeting_date_text: state.previousMeetingDate,
      },
    });
    if (timeline.created) result.timeline_events_created++;
    else result.timeline_events_updated++;

    await args.admin
      .from("project_signal_threads")
      .upsert(
        {
          project_id: args.projectId,
          thread_key: threadKey,
          source_type: "slack",
          current_state: "open",
          summary: state.latestRelevantMessage.slice(0, 240),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id,thread_key" },
      );
  }

  const { data: signals } = await args.admin
    .from("project_signals")
    .select("*")
    .eq("project_id", args.projectId)
    .eq("source_type", "slack")
    .in("signal_status", ["new", "processing", "processed"])
    .limit(200);

  for (const signal of signals ?? []) {
    const signalType = String(signal.signal_type ?? "");
    const metadata = (signal.metadata ?? {}) as Record<string, unknown>;

    if (signalType === "meeting_needed") continue;

    if (!isMeaningfulSlackSignal(signalType)) continue;

    if (signalType === "general_action" || signalType === "client_question" || signalType === "blocker" || signalType === "access_needed") {
      const channelName = typeof metadata.channel_name === "string" ? metadata.channel_name : null;
      const linkType = typeof metadata.link_type === "string" ? metadata.link_type : null;
      const actionResult = await upsertGeneralSlackSignalAction({
        admin: args.admin,
        projectId: args.projectId,
        signal: signal as Record<string, unknown>,
        channelName,
        linkType,
        createdBy: args.createdBy,
        existingItems: workingItems,
      });
      workingItems = actionResult.workingItems;

      if (actionResult.suppressed) {
        result.actions_suppressed++;
        if (actionResult.suppressionReason) result.suppression_reasons.push(actionResult.suppressionReason);
        result.reasons.push(`suppressed:${signalType}:${String(signal.id).slice(-8)}`);
      } else if (actionResult.outcome === "created_new_action") {
        result.actions_created++;
        result.reasons.push(`created:${signalType}:${String(signal.id).slice(-8)}`);
      } else if (actionResult.outcome === "duplicate_open_action_updated") {
        result.actions_updated++;
        result.duplicates_avoided++;
        result.reasons.push(`updated:${signalType}:${String(signal.id).slice(-8)}`);
      } else {
        result.duplicates_avoided++;
        result.reasons.push(`skipped:${actionResult.outcome}`);
      }
    }

    const timeline = await syncSlackSignalToTimeline({
      admin: args.admin,
      signal: signal as Record<string, unknown>,
      channelName: typeof metadata.channel_name === "string" ? metadata.channel_name : null,
      linkType: typeof metadata.link_type === "string" ? metadata.link_type : null,
    });
    if (timeline.created) result.timeline_events_created++;
    else if (timeline.synced) result.timeline_events_updated++;
  }

  return result;
}
