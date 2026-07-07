import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildSlackThreadKey,
  enqueueAnalyzeProjectSignalsJob,
  syncSlackEventToProjectSignals,
  type SlackEventRow,
} from "./projectSignalPipeline.ts";
import {
  classifySlackMessageText,
  isMeaningfulSlackSignal,
} from "./slackSignalClassification.ts";
import { resolveSlackEventMessageText } from "./slackMessageText.ts";
import type { ProjectSlackLinkRow } from "./slack-auth.ts";
import { processSlackThreadIntelligenceForProject } from "./slackPmActions.ts";
import type { SuppressionReason } from "./pmActionSuppression.ts";

export type ReprocessSlackPreview = {
  text: string;
  signal_type: string;
  priority: string;
  confidence: number;
  thread_key: string;
  action_key?: string;
  skipped_reason?: string;
  suppression_title?: string;
  suppression_dismissed_at?: string;
};

export type ReprocessSlackEventsResult = {
  events_checked: number;
  signals_upserted: number;
  meaningful_signals: number;
  noise_signals: number;
  threads_upserted: number;
  jobs_queued: number;
  actions_created: number;
  actions_updated: number;
  actions_auto_resolved: number;
  actions_suppressed: number;
  timeline_events_created: number;
  timeline_events_updated: number;
  threads_checked: number;
  duplicates_avoided: number;
  previews: ReprocessSlackPreview[];
  warnings: string[];
  suppression_reasons: SuppressionReason[];
};

type DbSlackEvent = SlackEventRow & {
  project_slack_link_id?: string | null;
  is_thread_reply?: boolean;
  is_bot_message?: boolean;
  raw_payload?: Record<string, unknown>;
};

function toSlackEventRow(event: DbSlackEvent): SlackEventRow {
  return {
    id: event.id,
    project_id: event.project_id,
    slack_team_id: event.slack_team_id,
    slack_channel_id: event.slack_channel_id,
    slack_ts: event.slack_ts,
    slack_thread_ts: event.slack_thread_ts,
    slack_user_name: event.slack_user_name,
    message_text: resolveSlackEventMessageText(event),
    message_preview: event.message_preview,
    signal_type: event.signal_type,
    signal_confidence: event.signal_confidence,
    link_type: event.link_type,
    is_client_facing: event.is_client_facing,
    include_in_ai: event.include_in_ai,
    include_in_client_updates: event.include_in_client_updates,
    is_thread_reply: event.is_thread_reply ?? false,
  };
}

export async function reprocessSlackEventsForProject(args: {
  admin: SupabaseClient;
  projectId: string;
  projectSlackLinkId?: string;
  force?: boolean;
}): Promise<ReprocessSlackEventsResult> {
  const result: ReprocessSlackEventsResult = {
    events_checked: 0,
    signals_upserted: 0,
    meaningful_signals: 0,
    noise_signals: 0,
    threads_upserted: 0,
    jobs_queued: 0,
    actions_created: 0,
    actions_updated: 0,
    actions_auto_resolved: 0,
    actions_suppressed: 0,
    timeline_events_created: 0,
    timeline_events_updated: 0,
    threads_checked: 0,
    duplicates_avoided: 0,
    previews: [],
    warnings: [],
    suppression_reasons: [],
  };

  let linksQuery = args.admin
    .from("project_slack_links")
    .select("*")
    .eq("project_id", args.projectId)
    .eq("status", "active");
  if (args.projectSlackLinkId) {
    linksQuery = linksQuery.eq("id", args.projectSlackLinkId);
  }
  const { data: links, error: linksError } = await linksQuery;
  if (linksError) throw new Error(linksError.message);
  if (!links || links.length === 0) {
    result.warnings.push("No active Slack channel links found for this project.");
    return result;
  }

  let eventsQuery = args.admin
    .from("project_slack_events")
    .select("*")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (args.projectSlackLinkId) {
    eventsQuery = eventsQuery.eq("project_slack_link_id", args.projectSlackLinkId);
  }
  const { data: events, error: eventsError } = await eventsQuery;
  if (eventsError) throw new Error(eventsError.message);
  if (!events || events.length === 0) {
    result.warnings.push("No Slack events found to reprocess.");
    return result;
  }

  const linksById = new Map(links.map((link) => [link.id, link as ProjectSlackLinkRow]));
  const meaningfulSignalIds: string[] = [];
  const meaningfulThreadKeys: string[] = [];
  let highestPriority = "medium";

  for (const rawEvent of events as DbSlackEvent[]) {
    result.events_checked++;

    if (rawEvent.is_bot_message && !args.force) {
      result.previews.push({
        text: resolveSlackEventMessageText(rawEvent).slice(0, 200),
        signal_type: "noise",
        priority: "low",
        confidence: 1,
        thread_key: buildSlackThreadKey(
          rawEvent.slack_team_id,
          rawEvent.slack_channel_id,
          rawEvent.slack_thread_ts,
          rawEvent.slack_ts,
        ),
        skipped_reason: "bot_message",
      });
      result.noise_signals++;
      continue;
    }

    const link =
      (rawEvent.project_slack_link_id ? linksById.get(rawEvent.project_slack_link_id) : null) ??
      (links[0] as ProjectSlackLinkRow);
    const eventRow = toSlackEventRow(rawEvent);
    const classification = classifySlackMessageText(eventRow.message_text);
    const threadKey = buildSlackThreadKey(
      eventRow.slack_team_id,
      eventRow.slack_channel_id,
      eventRow.slack_thread_ts,
      eventRow.slack_ts,
    );

    const preview: ReprocessSlackPreview = {
      text: (eventRow.message_text ?? "").slice(0, 200),
      signal_type: classification.signal_type,
      priority: classification.priority,
      confidence: classification.signal_confidence,
      thread_key: threadKey,
      action_key: classification.action_key ?? undefined,
    };

    if (!eventRow.message_text || eventRow.message_text.length < 2) {
      preview.skipped_reason = "empty_message_text";
      result.warnings.push(`Event ${rawEvent.id} has no usable message text for classification.`);
    }

    try {
      await args.admin
        .from("project_slack_events")
        .update({
          message_text: eventRow.message_text || rawEvent.message_text,
          signal_type: classification.signal_type,
          signal_confidence: classification.signal_confidence,
          processed_at: new Date().toISOString(),
        })
        .eq("id", rawEvent.id);

      const { signalId, stats } = await syncSlackEventToProjectSignals({
        admin: args.admin,
        link: link as ProjectSlackLinkRow & { channel_name?: string | null },
        event: {
          ...eventRow,
          signal_type: classification.signal_type,
          signal_confidence: classification.signal_confidence,
        },
        classification,
        rawPayload: rawEvent.raw_payload ?? null,
      });

      result.signals_upserted += stats.signals_upserted_count;
      result.threads_upserted += stats.signal_threads_upserted_count;
      result.jobs_queued += stats.jobs_queued_count;

      if (isMeaningfulSlackSignal(classification.signal_type)) {
        result.meaningful_signals++;
        if (signalId) meaningfulSignalIds.push(signalId);
        meaningfulThreadKeys.push(threadKey);
        if (classification.priority === "urgent" || classification.priority === "high") {
          highestPriority = classification.priority;
        }
      } else if (classification.signal_type === "noise") {
        result.noise_signals++;
        if (!preview.skipped_reason) preview.skipped_reason = "classified_as_noise";
      }
    } catch (error) {
      const message = (error as Error).message;
      preview.skipped_reason = `pipeline_error:${message}`;
      result.warnings.push(`Failed to normalize event ${rawEvent.id}: ${message}`);
    }

    result.previews.push(preview);
  }

  if (meaningfulSignalIds.length > 0) {
    const queued = await enqueueAnalyzeProjectSignalsJob({
      admin: args.admin,
      projectId: args.projectId,
      signalIds: meaningfulSignalIds,
      threadKeys: [...new Set(meaningfulThreadKeys)],
      priority: highestPriority,
    });
    if (queued) result.jobs_queued += 1;
  } else if (result.events_checked > 0) {
    result.warnings.push("All checked Slack events were classified as noise or skipped.");
  }

  try {
    const intelligence = await processSlackThreadIntelligenceForProject({
      admin: args.admin,
      projectId: args.projectId,
    });
    result.actions_created = intelligence.actions_created;
    result.actions_updated = intelligence.actions_updated;
    result.actions_auto_resolved = intelligence.actions_auto_resolved;
    result.actions_suppressed = intelligence.actions_suppressed;
    result.timeline_events_created = intelligence.timeline_events_created;
    result.timeline_events_updated = intelligence.timeline_events_updated;
    result.threads_checked = intelligence.threads_checked;
    result.duplicates_avoided = intelligence.duplicates_avoided;
    result.suppression_reasons = intelligence.suppression_reasons;

    for (const suppression of intelligence.suppression_reasons) {
      const preview = result.previews.find((item) => item.thread_key === suppression.thread_key);
      if (preview) {
        preview.skipped_reason = "suppressed_by_dismissed_action";
        preview.suppression_title = suppression.title ?? undefined;
        preview.suppression_dismissed_at = suppression.dismissed_at ?? undefined;
      }
    }
  } catch (error) {
    result.warnings.push(`Thread intelligence failed: ${(error as Error).message}`);
  }

  return result;
}
