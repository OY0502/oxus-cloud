import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isMeaningfulSlackSignal } from "./slackSignalClassification.ts";

export type ProjectTimelineUpsertInput = {
  project_id: string;
  source_type: string;
  source_table?: string | null;
  source_id?: string | null;
  external_id?: string | null;
  event_type: string;
  event_title: string;
  event_summary?: string | null;
  event_body?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  source_created_at?: string | null;
  priority?: string;
  visibility?: string;
  signal_type?: string | null;
  thread_key?: string | null;
  action_key?: string | null;
  related_pm_action_item_id?: string | null;
  related_clickup_task_id?: string | null;
  related_slack_channel_id?: string | null;
  source_url?: string | null;
  metadata?: Record<string, unknown>;
};

const MEANINGFUL_CLICKUP_EVENT_TYPES = new Set([
  "taskCreated",
  "taskClosed",
  "taskReopened",
  "taskCommentPosted",
  "taskCommentUpdated",
  "taskStatusUpdated",
  "taskPriorityUpdated",
  "taskDueDateUpdated",
  "taskMoved",
]);

const SKIP_CLICKUP_EVENT_TYPES = new Set(["manual_clickup_sync"]);

export function isMeaningfulClickupTimelineEvent(eventType: string): boolean {
  if (SKIP_CLICKUP_EVENT_TYPES.has(eventType)) return false;
  return MEANINGFUL_CLICKUP_EVENT_TYPES.has(eventType);
}

export function clickupEventPriority(eventType: string): string {
  if (eventType === "taskClosed" || eventType === "taskReopened") return "medium";
  if (eventType === "taskPriorityUpdated" || eventType === "taskStatusUpdated") return "medium";
  return "low";
}

export async function upsertProjectTimelineEvent(
  admin: SupabaseClient,
  input: ProjectTimelineUpsertInput,
): Promise<{ id: string; created: boolean }> {
  const row = {
    project_id: input.project_id,
    source_type: input.source_type,
    source_table: input.source_table ?? null,
    source_id: input.source_id ?? null,
    external_id: input.external_id ?? null,
    event_type: input.event_type,
    event_title: input.event_title,
    event_summary: input.event_summary ?? null,
    event_body: input.event_body ?? null,
    actor_name: input.actor_name ?? null,
    actor_email: input.actor_email ?? null,
    source_created_at: input.source_created_at ?? null,
    priority: input.priority ?? "medium",
    visibility: input.visibility ?? "internal",
    signal_type: input.signal_type ?? null,
    thread_key: input.thread_key ?? null,
    action_key: input.action_key ?? null,
    related_pm_action_item_id: input.related_pm_action_item_id ?? null,
    related_clickup_task_id: input.related_clickup_task_id ?? null,
    related_slack_channel_id: input.related_slack_channel_id ?? null,
    source_url: input.source_url ?? null,
    metadata: input.metadata ?? {},
  };

  if (input.source_id) {
    const { data: existing } = await admin
      .from("project_timeline_events")
      .select("id")
      .eq("source_type", input.source_type)
      .eq("source_table", input.source_table ?? "")
      .eq("source_id", input.source_id)
      .maybeSingle();
    if (existing?.id) {
      await admin.from("project_timeline_events").update(row).eq("id", existing.id);
      return { id: existing.id, created: false };
    }
  }

  if (input.external_id) {
    const { data: existing } = await admin
      .from("project_timeline_events")
      .select("id")
      .eq("project_id", input.project_id)
      .eq("external_id", input.external_id)
      .maybeSingle();
    if (existing?.id) {
      await admin.from("project_timeline_events").update(row).eq("id", existing.id);
      return { id: existing.id, created: false };
    }
  }

  const { data, error } = await admin.from("project_timeline_events").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, created: true };
}

export async function syncClickupTimelineRowToUnified(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ synced: boolean; created?: boolean; id?: string }> {
  const eventType = String(row.event_type ?? "");
  if (!isMeaningfulClickupTimelineEvent(eventType)) return { synced: false };

  const projectId = String(row.project_id);
  const taskId = typeof row.clickup_task_id === "string" ? row.clickup_task_id : null;
  const rawPayload = (row.raw_payload ?? {}) as Record<string, unknown>;
  const taskUrl =
    typeof rawPayload?.task === "object" && rawPayload.task && "url" in (rawPayload.task as object)
      ? String((rawPayload.task as { url?: string }).url ?? "")
      : null;

  const result = await upsertProjectTimelineEvent(admin, {
    project_id: projectId,
    source_type: "clickup",
    source_table: "project_clickup_timeline_events",
    source_id: typeof row.id === "string" ? row.id : null,
    event_type: `clickup_${eventType}`,
    event_title: String(row.event_title ?? "ClickUp update"),
    event_summary: typeof row.event_summary === "string" ? row.event_summary : null,
    event_body: typeof row.comment_text === "string" ? row.comment_text : null,
    actor_name: typeof row.actor_name === "string" ? row.actor_name : null,
    actor_email: typeof row.actor_email === "string" ? row.actor_email : null,
    source_created_at:
      typeof row.clickup_date === "string" ? row.clickup_date : typeof row.created_at === "string" ? row.created_at : null,
    priority: clickupEventPriority(eventType),
    visibility: "internal",
    related_clickup_task_id: taskId,
    source_url: taskUrl || null,
    metadata: {
      clickup_event_type: eventType,
      direction: row.direction ?? null,
      dedupe_key: row.dedupe_key ?? null,
    },
  });

  return { synced: true, created: result.created, id: result.id };
}

export async function syncSlackSignalToTimeline(args: {
  admin: SupabaseClient;
  signal: Record<string, unknown>;
  channelName?: string | null;
  linkType?: string | null;
  visibility?: string;
}): Promise<{ synced: boolean; created?: boolean; id?: string }> {
  const signalType = typeof args.signal.signal_type === "string" ? args.signal.signal_type : null;
  if (!signalType || !isMeaningfulSlackSignal(signalType)) return { synced: false };

  const projectId = String(args.signal.project_id);
  const threadKey = typeof args.signal.thread_key === "string" ? args.signal.thread_key : null;
  const body = typeof args.signal.body === "string" ? args.signal.body : null;
  const summary = typeof args.signal.summary === "string" ? args.signal.summary : null;
  const metadata = (args.signal.metadata ?? {}) as Record<string, unknown>;

  const titleMap: Record<string, string> = {
    meeting_needed: "Meeting needs scheduling",
    general_action: "Work request from Slack",
    blocker: "Blocker reported",
    access_needed: "Access needed",
    client_question: "Client question",
    decision: "Decision made",
    scope_change: "Scope change",
    deadline: "Deadline mentioned",
    risk: "Risk flagged",
    progress_update: "Progress update",
    resolved: "Issue resolved",
  };

  const actionFamily =
    typeof metadata.action_family === "string" ? metadata.action_family : signalType ?? "general";
  const eventTitle =
    signalType === "general_action" && typeof args.signal.title === "string"
      ? args.signal.title
      : titleMap[signalType ?? ""] ?? "Slack signal";

  const result = await upsertProjectTimelineEvent(args.admin, {
    project_id: projectId,
    source_type: "slack",
    source_table: "project_signals",
    source_id: typeof args.signal.id === "string" ? args.signal.id : null,
    external_id: threadKey ? `slack:signal:${threadKey}:${actionFamily}` : null,
    event_type: "slack_signal",
    event_title: eventTitle,
    event_summary: summary ?? `Slack message classified as ${signalType?.replace(/_/g, " ") ?? "signal"}.`,
    event_body: body,
    actor_name: typeof metadata.slack_user_name === "string" ? metadata.slack_user_name : null,
    source_created_at:
      typeof metadata.slack_ts === "string"
        ? new Date(Number(metadata.slack_ts.split(".")[0]) * 1000).toISOString()
        : typeof args.signal.created_at === "string"
          ? args.signal.created_at
          : null,
    priority: typeof args.signal.priority === "string" ? args.signal.priority : "medium",
    visibility: args.visibility ?? (args.linkType === "external" ? "external" : "internal"),
    signal_type: signalType,
    thread_key: threadKey,
    action_key: typeof args.signal.action_key === "string" ? args.signal.action_key : null,
    related_slack_channel_id:
      typeof metadata.slack_channel_id === "string" ? metadata.slack_channel_id : null,
    metadata: {
      channel_name: args.channelName ?? metadata.channel_name ?? null,
      link_type: args.linkType ?? metadata.link_type ?? null,
      slack_ts: metadata.slack_ts ?? null,
      slack_thread_ts: metadata.slack_thread_ts ?? null,
    },
  });

  return { synced: true, created: result.created, id: result.id };
}

export async function upsertSlackThreadUpdateTimelineEvent(args: {
  admin: SupabaseClient;
  projectId: string;
  threadKey: string;
  eventTitle: string;
  eventSummary: string;
  eventBody?: string | null;
  actorName?: string | null;
  sourceCreatedAt?: string | null;
  signalType?: string;
  relatedPmActionItemId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  linkType?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; created: boolean }> {
  return upsertProjectTimelineEvent(args.admin, {
    project_id: args.projectId,
    source_type: "slack",
    source_table: "project_signal_threads",
    external_id: `slack:thread_update:${args.threadKey}:${args.signalType ?? "meeting_needed"}`,
    event_type: "slack_thread_update",
    event_title: args.eventTitle,
    event_summary: args.eventSummary,
    event_body: args.eventBody ?? null,
    actor_name: args.actorName ?? null,
    source_created_at: args.sourceCreatedAt ?? null,
    priority: "medium",
    visibility: args.linkType === "external" ? "external" : "internal",
    signal_type: args.signalType ?? "meeting_needed",
    thread_key: args.threadKey,
    related_pm_action_item_id: args.relatedPmActionItemId ?? null,
    related_slack_channel_id: args.channelId ?? null,
    metadata: {
      channel_name: args.channelName ?? null,
      link_type: args.linkType ?? null,
      ...(args.metadata ?? {}),
    },
  });
}

export async function createPmActionResolvedTimelineEvent(args: {
  admin: SupabaseClient;
  projectId: string;
  actionId: string;
  title: string;
  summary: string;
  threadKey?: string | null;
}): Promise<void> {
  await upsertProjectTimelineEvent(args.admin, {
    project_id: args.projectId,
    source_type: "pm_action",
    source_table: "project_pm_action_items",
    source_id: args.actionId,
    external_id: `pm_action:resolved:${args.actionId}`,
    event_type: "pm_action_auto_resolved",
    event_title: args.title,
    event_summary: args.summary,
    related_pm_action_item_id: args.actionId,
    thread_key: args.threadKey ?? null,
    priority: "low",
    visibility: "internal",
    signal_type: "resolved",
  });
}

export async function backfillProjectTimelineFromExisting(args: {
  admin: SupabaseClient;
  projectId: string;
}): Promise<{
  clickup_synced: number;
  slack_signals_synced: number;
}> {
  let clickupSynced = 0;
  let slackSignalsSynced = 0;

  const { data: clickupRows } = await args.admin
    .from("project_clickup_timeline_events")
    .select("*")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(500);

  for (const row of clickupRows ?? []) {
    const result = await syncClickupTimelineRowToUnified(args.admin, row as Record<string, unknown>);
    if (result.synced) clickupSynced++;
  }

  const { data: signals } = await args.admin
    .from("project_signals")
    .select("*")
    .eq("project_id", args.projectId)
    .eq("source_type", "slack")
    .limit(500);

  for (const signal of signals ?? []) {
    const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
    const result = await syncSlackSignalToTimeline({
      admin: args.admin,
      signal: signal as Record<string, unknown>,
      channelName: typeof metadata.channel_name === "string" ? metadata.channel_name : null,
      linkType: typeof metadata.link_type === "string" ? metadata.link_type : null,
    });
    if (result.synced) slackSignalsSynced++;
  }

  return { clickup_synced: clickupSynced, slack_signals_synced: slackSignalsSynced };
}
