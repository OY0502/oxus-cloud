import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  classifySlackMessageWithContext,
  isMeaningfulSlackSignal,
  type SlackSignalClassification,
} from "./slackSignalClassification.ts";
import { classifySlackActor } from "./classifySlackActor.ts";
import type { ProjectSlackLinkRow } from "./slack-auth.ts";
import { resolveSlackEventMessageText } from "./slackMessageText.ts";
import { extractSlackAttachments } from "./slackAttachments.ts";

export type SlackEventRow = {
  id: string;
  project_id: string | null;
  slack_team_id: string;
  slack_channel_id: string;
  slack_ts: string;
  slack_thread_ts: string | null;
  slack_user_name: string | null;
  message_text: string | null;
  message_preview: string | null;
  signal_type: string | null;
  signal_confidence: number | null;
  link_type: string | null;
  is_client_facing: boolean;
  include_in_ai: boolean;
  include_in_client_updates: boolean;
  is_thread_reply?: boolean;
  actor_classification?: string | null;
  actor_profile_id?: string | null;
  actor_contact_id?: string | null;
  actor_is_project_contact?: boolean;
};

export type SignalPipelineStats = {
  signals_upserted_count: number;
  meaningful_signals_count: number;
  signal_threads_upserted_count: number;
  jobs_queued_count: number;
};

export function slackTsToIso(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

export function buildSlackThreadKey(
  teamId: string,
  channelId: string,
  threadTs: string | null | undefined,
  messageTs: string,
): string {
  const root = threadTs ?? messageTs;
  return `slack:${teamId}:${channelId}:${root}`;
}

export function buildSlackExternalId(teamId: string, channelId: string, ts: string): string {
  return `${teamId}:${channelId}:${ts}`;
}

function threadStateForSignal(signalType: string): "open" | "resolved" | "ignored" | "unclear" {
  if (signalType === "resolved") return "resolved";
  if (signalType === "noise") return "ignored";
  if (isMeaningfulSlackSignal(signalType)) return "open";
  return "unclear";
}

export type IncrementalSlackSyncResult = {
  events_checked: number;
  events_synced: number;
  signals_new: number;
  signals_already_processed: number;
  jobs_queued: number;
};

const PROCESSED_SIGNAL_STATUSES = new Set(["processed", "merged", "ignored"]);

export async function syncIncrementalSlackEventsForProject(args: {
  admin: SupabaseClient;
  projectId: string;
  limit?: number;
}): Promise<IncrementalSlackSyncResult> {
  const result: IncrementalSlackSyncResult = {
    events_checked: 0,
    events_synced: 0,
    signals_new: 0,
    signals_already_processed: 0,
    jobs_queued: 0,
  };

  const { data: links, error: linksError } = await args.admin
    .from("project_slack_links")
    .select("*")
    .eq("project_id", args.projectId)
    .eq("status", "active");
  if (linksError) throw new Error(linksError.message);
  if (!links || links.length === 0) return result;

  const link = links[0] as ProjectSlackLinkRow & { channel_name?: string | null };

  const { data: events, error: eventsError } = await args.admin
    .from("project_slack_events")
    .select("*")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 100);
  if (eventsError) throw new Error(eventsError.message);
  if (!events || events.length === 0) return result;

  for (const raw of events) {
    result.events_checked++;
    const event = raw as SlackEventRow & { raw_payload?: Record<string, unknown>; message_preview?: string | null };
    const externalId = buildSlackExternalId(event.slack_team_id, event.slack_channel_id, event.slack_ts);

    const { data: existingSignal } = await args.admin
      .from("project_signals")
      .select("id, signal_status")
      .eq("external_id", externalId)
      .maybeSingle();

    if (existingSignal?.signal_status && PROCESSED_SIGNAL_STATUSES.has(existingSignal.signal_status)) {
      result.signals_already_processed++;
      continue;
    }

    const messageText = resolveSlackEventMessageText(event);
    const actor = await classifySlackActor({
      admin: args.admin,
      projectId: args.projectId,
      slackUserName: event.slack_user_name,
      slackUserEmail: typeof (event.raw_payload as Record<string, unknown> | undefined)?.user_email === "string"
        ? String((event.raw_payload as Record<string, unknown>).user_email)
        : null,
      linkType: link.link_type,
      isClientFacing: link.is_client_facing ?? false,
    });
    const classification = classifySlackMessageWithContext(messageText, {
      actor_name: event.slack_user_name,
      actor_classification: actor.classification,
      link_type: link.link_type,
      is_client_facing: link.is_client_facing ?? false,
    });

    await args.admin
      .from("project_slack_events")
      .update({
        message_text: messageText || event.message_text,
        signal_type: classification.signal_type,
        signal_confidence: classification.signal_confidence,
        actor_classification: actor.classification,
        actor_profile_id: actor.profile_id,
        actor_contact_id: actor.contact_id,
        actor_is_project_contact: actor.is_project_contact,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);

    const { signalId, stats, signalStatus } = await syncSlackEventToProjectSignals({
      admin: args.admin,
      link,
      event: {
        ...event,
        message_text: messageText,
        signal_type: classification.signal_type,
        signal_confidence: classification.signal_confidence,
      },
      classification,
      rawPayload: event.raw_payload ?? null,
    });

    result.events_synced++;
    if (signalStatus === "new") result.signals_new++;
    else if (signalStatus && PROCESSED_SIGNAL_STATUSES.has(signalStatus)) {
      result.signals_already_processed++;
    }
    result.jobs_queued += stats.jobs_queued_count;
    void signalId;
  }

  return result;
}

export async function enqueueAnalyzeProjectSignalsJob(args: {
  admin: SupabaseClient;
  projectId: string;
  signalIds: string[];
  threadKeys: string[];
  priority?: string;
}): Promise<boolean> {
  if (args.signalIds.length === 0) return false;

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: existing } = await args.admin
    .from("ai_processing_jobs")
    .select("id, payload")
    .eq("project_id", args.projectId)
    .eq("job_type", "analyze_project_signals")
    .in("status", ["queued", "running"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    const mergedSignalIds = [
      ...new Set([
        ...((payload.signal_ids as string[] | undefined) ?? []),
        ...args.signalIds,
      ]),
    ];
    const mergedThreadKeys = [
      ...new Set([
        ...((payload.thread_keys as string[] | undefined) ?? []),
        ...args.threadKeys,
      ]),
    ];
    await args.admin
      .from("ai_processing_jobs")
      .update({
        payload: {
          ...payload,
          source: "slack",
          signal_ids: mergedSignalIds,
          thread_keys: mergedThreadKeys,
          source_type: "slack",
        },
      })
      .eq("id", existing.id);
    return false;
  }

  const { error } = await args.admin.from("ai_processing_jobs").insert({
    project_id: args.projectId,
    job_type: "analyze_project_signals",
    status: "queued",
    priority: args.priority ?? "medium",
    payload: {
      source: "slack",
      signal_ids: args.signalIds,
      thread_keys: args.threadKeys,
      source_type: "slack",
    },
  });
  if (error) throw new Error(error.message);
  return true;
}

export async function syncSlackEventToProjectSignals(args: {
  admin: SupabaseClient;
  link: ProjectSlackLinkRow & { channel_name?: string | null };
  event: SlackEventRow;
  classification?: SlackSignalClassification;
  rawPayload?: Record<string, unknown> | null;
}): Promise<{ signalId: string | null; stats: SignalPipelineStats; signalStatus: string }> {
  const stats: SignalPipelineStats = {
    signals_upserted_count: 0,
    meaningful_signals_count: 0,
    signal_threads_upserted_count: 0,
    jobs_queued_count: 0,
  };

  const classification = args.classification ??
    classifySlackMessageWithContext(args.event.message_text, {
      actor_name: args.event.slack_user_name,
      link_type: args.event.link_type ?? args.link.link_type,
      is_client_facing: args.event.is_client_facing ?? args.link.is_client_facing,
    });
  const meaningful = isMeaningfulSlackSignal(classification.signal_type);
  const threadKey = buildSlackThreadKey(
    args.event.slack_team_id,
    args.event.slack_channel_id,
    args.event.slack_thread_ts,
    args.event.slack_ts,
  );
  const externalId = buildSlackExternalId(
    args.event.slack_team_id,
    args.event.slack_channel_id,
    args.event.slack_ts,
  );

  const { data: existingSignal } = await args.admin
    .from("project_signals")
    .select("id, signal_status, processed_at")
    .eq("external_id", externalId)
    .maybeSingle();

  const wasAlreadyHandled =
    !!existingSignal?.signal_status && PROCESSED_SIGNAL_STATUSES.has(existingSignal.signal_status);

  const attachments = extractSlackAttachments(args.rawPayload ?? null);
  const signalStatus = meaningful
    ? (wasAlreadyHandled ? existingSignal!.signal_status : "new")
    : classification.signal_type === "noise"
    ? "ignored"
    : "processed";
  const threadRootTs = args.event.slack_thread_ts ?? args.event.slack_ts;
  const actorClassification =
    typeof args.event.actor_classification === "string" ? args.event.actor_classification : null;

  const signalRow = {
    project_id: args.event.project_id ?? args.link.project_id,
    source_type: "slack",
    source_table: "project_slack_events",
    source_id: args.event.id,
    external_id: externalId,
    actor_name: args.event.slack_user_name,
    actor_classification: actorClassification,
    actor_profile_id: args.event.actor_profile_id ?? null,
    actor_contact_id: args.event.actor_contact_id ?? null,
    source_created_at: slackTsToIso(args.event.slack_ts),
    title: classification.title,
    summary: classification.summary,
    body: args.event.message_text,
    signal_type: classification.signal_type,
    priority: classification.priority,
    confidence: classification.signal_confidence,
    thread_key: threadKey,
    action_key: classification.action_key,
    signal_status: signalStatus,
    is_client_facing: args.event.is_client_facing ?? args.link.is_client_facing,
    include_in_ai: args.event.include_in_ai ?? args.link.include_in_ai,
    include_in_client_updates: args.event.include_in_client_updates ?? args.link.include_in_client_updates,
    metadata: {
      source: "slack",
      slack_team_id: args.event.slack_team_id,
      slack_channel_id: args.event.slack_channel_id,
      slack_ts: args.event.slack_ts,
      slack_thread_ts: threadRootTs,
      is_thread_reply: args.event.is_thread_reply ?? false,
      link_type: args.event.link_type ?? args.link.link_type,
      channel_name: args.link.channel_name ?? null,
      action_family: classification.action_family ?? null,
      suggested_action_type: classification.suggested_action_type ?? null,
      actor_classification: actorClassification,
      attachments: attachments.length > 0 ? attachments : undefined,
      skip_reason: classification.signal_type === "noise" ? "classified_as_noise" : null,
    },
    processed_at: meaningful && signalStatus === "new" ? null : new Date().toISOString(),
  };

  const { data: signal, error: signalError } = await args.admin
    .from("project_signals")
    .upsert(signalRow, { onConflict: "external_id" })
    .select("id, signal_type, signal_status, thread_key, action_key, title, summary, priority")
    .single();
  if (signalError) throw new Error(signalError.message);

  stats.signals_upserted_count = 1;
  if (meaningful) stats.meaningful_signals_count = 1;

  const threadState = threadStateForSignal(classification.signal_type);
  const { data: existingThread } = await args.admin
    .from("project_signal_threads")
    .select("id, signal_count, current_state")
    .eq("project_id", args.link.project_id)
    .eq("thread_key", threadKey)
    .maybeSingle();

  const threadRow: Record<string, unknown> = {
    project_id: args.event.project_id ?? args.link.project_id,
    thread_key: threadKey,
    source_type: "slack",
    current_state: threadState === "open"
      ? "open"
      : existingThread?.current_state === "open" && threadState === "resolved"
      ? "resolved"
      : threadState,
    latest_signal_id: signal.id,
    latest_signal_at: slackTsToIso(args.event.slack_ts) ?? new Date().toISOString(),
    signal_count: (existingThread?.signal_count ?? 0) + 1,
    summary: classification.summary,
    metadata: {
      source: "slack",
      channel_name: args.link.channel_name ?? null,
      link_type: args.event.link_type ?? args.link.link_type,
      priority: classification.priority,
      title: classification.title,
    },
  };
  if (meaningful || classification.signal_type === "resolved" || !existingThread) {
    threadRow.primary_signal_type = classification.signal_type;
  }

  const { error: threadError } = await args.admin
    .from("project_signal_threads")
    .upsert(threadRow, { onConflict: "project_id,thread_key" });
  if (threadError) throw new Error(threadError.message);
  stats.signal_threads_upserted_count = 1;

  if (meaningful && signalStatus === "new") {
    const queued = await enqueueAnalyzeProjectSignalsJob({
      admin: args.admin,
      projectId: args.link.project_id,
      signalIds: [signal.id],
      threadKeys: [threadKey],
      priority: classification.priority,
    });
    if (queued) stats.jobs_queued_count = 1;
  }

  return { signalId: signal.id, stats, signalStatus };
}

export async function reclassifyExistingSlackEvent(args: {
  admin: SupabaseClient;
  link: ProjectSlackLinkRow & { channel_name?: string | null };
  event: SlackEventRow & { message_preview?: string | null; raw_payload?: Record<string, unknown> | null };
}): Promise<SignalPipelineStats> {
  const messageText = resolveSlackEventMessageText(args.event);
  const actor = await classifySlackActor({
    admin: args.admin,
    projectId: args.link.project_id,
    slackUserName: args.event.slack_user_name,
    slackUserEmail: typeof args.event.raw_payload?.user_email === "string"
      ? args.event.raw_payload.user_email
      : null,
    linkType: args.event.link_type ?? args.link.link_type,
    isClientFacing: args.event.is_client_facing ?? args.link.is_client_facing ?? false,
  });
  const classification = classifySlackMessageWithContext(messageText, {
    actor_name: args.event.slack_user_name,
    actor_classification: actor.classification,
    link_type: args.event.link_type ?? args.link.link_type,
    is_client_facing: args.event.is_client_facing ?? args.link.is_client_facing,
  });
  const now = new Date().toISOString();

  await args.admin
    .from("project_slack_events")
    .update({
      message_text: messageText || args.event.message_text,
      signal_type: classification.signal_type,
      signal_confidence: classification.signal_confidence,
      actor_classification: actor.classification,
      actor_profile_id: actor.profile_id,
      actor_contact_id: actor.contact_id,
      actor_is_project_contact: actor.is_project_contact,
      processed_at: now,
    })
    .eq("id", args.event.id);

  const { stats, signalStatus } = await syncSlackEventToProjectSignals({
    admin: args.admin,
    link: args.link,
    event: {
      ...args.event,
      message_text: messageText,
      signal_type: classification.signal_type,
      signal_confidence: classification.signal_confidence,
      actor_classification: actor.classification,
      actor_profile_id: actor.profile_id,
      actor_contact_id: actor.contact_id,
      actor_is_project_contact: actor.is_project_contact,
    },
    classification,
    rawPayload: args.event.raw_payload ?? null,
  });

  void signalStatus;
  return stats;
}
