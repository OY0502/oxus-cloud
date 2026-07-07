import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { messagePreview } from "./slack.ts";
import { classifySlackMessageText } from "./slackSignalClassification.ts";
import { resolveSlackApiMessageText } from "./slackMessageText.ts";
import { isSlackTsAfter } from "./memoryMerge.ts";
import {
  syncSlackEventToProjectSignals,
  type SignalPipelineStats,
  type SlackEventRow,
} from "./projectSignalPipeline.ts";
import type { ProjectSlackLinkRow } from "./slack-auth.ts";

export type SlackMessageInput = {
  slack_team_id: string;
  slack_channel_id: string;
  slack_ts: string;
  slack_thread_ts?: string | null;
  slack_user_id?: string | null;
  slack_user_name?: string | null;
  message_text?: string | null;
  event_type?: string;
  is_thread_reply?: boolean;
  is_bot_message?: boolean;
  raw_payload?: Record<string, unknown>;
};

export type UpsertSlackEventResult = {
  result: "inserted" | "updated" | "skipped";
  event: SlackEventRow | null;
  pipeline: SignalPipelineStats;
};

const EMPTY_PIPELINE: SignalPipelineStats = {
  signals_upserted_count: 0,
  meaningful_signals_count: 0,
  signal_threads_upserted_count: 0,
  jobs_queued_count: 0,
};

export async function upsertProjectSlackEvent(args: {
  admin: SupabaseClient;
  link: ProjectSlackLinkRow & { channel_name?: string | null };
  message: SlackMessageInput;
}): Promise<UpsertSlackEventResult> {
  const { link, message, admin } = args;
  if (message.is_bot_message) {
    return { result: "skipped", event: null, pipeline: EMPTY_PIPELINE };
  }

  const baselineTs = link.ingest_from_ts ?? null;
  if (!isSlackTsAfter(message.slack_ts, baselineTs)) {
    return { result: "skipped", event: null, pipeline: EMPTY_PIPELINE };
  }

  const text = (message.message_text ?? "").trim() ||
    resolveSlackApiMessageText((message.raw_payload ?? {}) as Record<string, unknown>);
  const classification = classifySlackMessageText(text);
  const dedupeKey = `${message.slack_team_id}:${message.slack_channel_id}:${message.slack_ts}`;
  const now = new Date().toISOString();
  const threadRoot = message.slack_thread_ts ?? message.slack_ts;

  const row = {
    project_id: link.project_id,
    project_slack_link_id: link.id,
    slack_team_id: message.slack_team_id,
    slack_channel_id: message.slack_channel_id,
    slack_user_id: message.slack_user_id ?? null,
    slack_user_name: message.slack_user_name ?? null,
    slack_ts: message.slack_ts,
    slack_thread_ts: threadRoot,
    event_type: message.event_type ?? "message",
    message_text: text || null,
    message_preview: messagePreview(text),
    is_thread_reply: message.is_thread_reply ?? false,
    is_bot_message: message.is_bot_message ?? false,
    link_type: link.link_type,
    is_client_facing: link.is_client_facing,
    include_in_ai: link.include_in_ai,
    include_in_client_updates: link.include_in_client_updates,
    raw_payload: message.raw_payload ?? {},
    dedupe_key: dedupeKey,
    signal_type: classification.signal_type,
    signal_confidence: classification.signal_confidence,
    processed_at: now,
  };

  const { data: event, error } = await admin
    .from("project_slack_events")
    .upsert(row, {
      onConflict: "slack_team_id,slack_channel_id,slack_ts",
      ignoreDuplicates: false,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const { stats: pipeline } = await syncSlackEventToProjectSignals({
    admin,
    link,
    event: event as SlackEventRow,
    classification,
  });

  if (message.slack_ts) {
    await admin
      .from("project_slack_links")
      .update({ last_processed_ts: message.slack_ts })
      .eq("id", link.id);
  }

  return { result: "inserted", event: event as SlackEventRow, pipeline };
}

export function slackMessageFromHistory(args: {
  message: Record<string, unknown>;
  teamId: string;
  channelId: string;
  threadTs?: string | null;
}): SlackMessageInput {
  const msg = args.message;
  const text = resolveSlackApiMessageText(msg);
  const ts = String(msg.ts ?? "");
  const user = typeof msg.user === "string" ? msg.user : null;
  const isExplicitReply = args.threadTs != null;
  const rawThreadTs = isExplicitReply
    ? args.threadTs
    : typeof msg.thread_ts === "string"
    ? msg.thread_ts
    : null;
  const isThreadReply = isExplicitReply || (!!rawThreadTs && rawThreadTs !== ts);
  const threadRoot = isThreadReply ? rawThreadTs : ts;

  return {
    slack_team_id: args.teamId,
    slack_channel_id: args.channelId,
    slack_ts: ts,
    slack_thread_ts: threadRoot,
    slack_user_id: user,
    message_text: text || null,
    event_type: typeof msg.subtype === "string" ? msg.subtype : "message",
    is_thread_reply: isThreadReply,
    is_bot_message: !!msg.bot_id || msg.subtype === "bot_message",
    raw_payload: msg,
  };
}

export function slackMessageFromEvent(event: Record<string, unknown>, teamId: string): SlackMessageInput | null {
  const channelId = typeof event.channel === "string" ? event.channel : null;
  const ts = typeof event.ts === "string" ? event.ts : null;
  if (!channelId || !ts) return null;

  const text = typeof event.text === "string" ? event.text : null;
  const resolvedText = resolveSlackApiMessageText(event as Record<string, unknown>) || text;
  const user = typeof event.user === "string" ? event.user : null;
  const rawThreadTs = typeof event.thread_ts === "string" ? event.thread_ts : null;
  const isThreadReply = !!rawThreadTs && rawThreadTs !== ts;
  const threadRoot = isThreadReply ? rawThreadTs : ts;

  return {
    slack_team_id: teamId,
    slack_channel_id: channelId,
    slack_ts: ts,
    slack_thread_ts: threadRoot,
    slack_user_id: user,
    message_text: resolvedText || text,
    event_type: typeof event.subtype === "string" ? event.subtype : "message",
    is_thread_reply: isThreadReply,
    is_bot_message: !!event.bot_id || event.subtype === "bot_message",
    raw_payload: event,
  };
}
