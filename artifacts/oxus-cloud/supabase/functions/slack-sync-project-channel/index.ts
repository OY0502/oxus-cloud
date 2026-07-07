import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getAuthenticatedUser, getSlackWorkspaceTokenOrThrow } from "../_shared/slack-auth.ts";
import { callSlackApi } from "../_shared/slack.ts";
import { isSlackTsAfter } from "../_shared/memoryMerge.ts";
import {
  classifySlackMessageText,
  isMeaningfulSlackSignal,
} from "../_shared/slackSignalClassification.ts";
import {
  reprocessSlackEventsForProject,
  type ReprocessSlackEventsResult,
} from "../_shared/reprocessSlackEvents.ts";
import {
  slackMessageFromHistory,
  upsertProjectSlackEvent,
} from "../_shared/slackEventStore.ts";
import type { ProjectSlackLinkRow } from "../_shared/slack-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
}

function emptyPipeline(): SignalPipelineStats {
  return {
    signals_upserted_count: 0,
    meaningful_signals_count: 0,
    signal_threads_upserted_count: 0,
    jobs_queued_count: 0,
  };
}

function mergePipeline(target: SignalPipelineStats, source: SignalPipelineStats) {
  target.signals_upserted_count += source.signals_upserted_count;
  target.meaningful_signals_count += source.meaningful_signals_count;
  target.signal_threads_upserted_count += source.signal_threads_upserted_count;
  target.jobs_queued_count += source.jobs_queued_count;
}

function mergeReprocessIntoAggregate(
  aggregate: {
    signals_upserted_count: number;
    meaningful_signals_count: number;
    signal_threads_upserted_count: number;
    jobs_queued_count: number;
    warnings: string[];
    latest_messages_preview: Array<{
      text: string;
      signal_type: string;
      priority: string;
      thread_key: string;
      include_in_ai: boolean;
    }>;
  },
  reprocess: ReprocessSlackEventsResult,
) {
  aggregate.signals_upserted_count = Math.max(aggregate.signals_upserted_count, reprocess.signals_upserted);
  aggregate.meaningful_signals_count = Math.max(aggregate.meaningful_signals_count, reprocess.meaningful_signals);
  aggregate.signal_threads_upserted_count = Math.max(
    aggregate.signal_threads_upserted_count,
    reprocess.threads_upserted,
  );
  aggregate.jobs_queued_count = Math.max(aggregate.jobs_queued_count, reprocess.jobs_queued);
  aggregate.warnings.push(...reprocess.warnings);
  for (const preview of reprocess.previews.slice(0, 10)) {
    aggregate.latest_messages_preview.push({
      text: preview.text,
      signal_type: preview.signal_type,
      priority: preview.priority,
      thread_key: preview.thread_key,
      include_in_ai: true,
    });
  }
}

async function syncLink(args: {
  admin: ReturnType<typeof getServiceRoleSupabase>;
  link: ProjectSlackLinkRow & { slack_channel_id: string; slack_team_id: string; channel_name?: string | null };
  token: string;
  limit: number;
}) {
  let imported = 0;
  let threadReplies = 0;
  let skipped = 0;
  let skippedHistorical = 0;
  let eventsUpserted = 0;
  const pipeline = emptyPipeline();
  const previews: Array<{
    text: string;
    signal_type: string;
    priority: string;
    thread_key: string;
    include_in_ai: boolean;
  }> = [];
  const warnings: string[] = [];
  let latestTs: string | null = null;

  const history = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(
    args.token,
    "conversations.history",
    { channel: args.link.slack_channel_id, limit: args.limit },
  );

  const messages = (history.messages ?? []).slice().reverse();
  for (const msg of messages) {
    const input = slackMessageFromHistory({
      message: msg,
      teamId: args.link.slack_team_id,
      channelId: args.link.slack_channel_id,
    });
    if (input.is_bot_message || !input.slack_ts) {
      skipped++;
      continue;
    }

    const baselineTs = args.link.ingest_from_ts ?? null;
    if (!isSlackTsAfter(input.slack_ts, baselineTs)) {
      skipped++;
      skippedHistorical++;
      continue;
    }

    const upsertResult = await upsertProjectSlackEvent({ admin: args.admin, link: args.link, message: input });
    if (upsertResult.result === "skipped") {
      skipped++;
      continue;
    }

    imported++;
    eventsUpserted++;
    mergePipeline(pipeline, upsertResult.pipeline);
    latestTs = input.slack_ts;

    const classification = classifySlackMessageText(input.message_text);
    previews.push({
      text: (input.message_text ?? "").slice(0, 200),
      signal_type: classification.signal_type,
      priority: classification.priority,
      thread_key: input.slack_thread_ts ?? input.slack_ts,
      include_in_ai: args.link.include_in_ai,
    });

    const replyCount = typeof msg.reply_count === "number" ? msg.reply_count : 0;
    if (replyCount > 0 && input.slack_ts) {
      const replies = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(
        args.token,
        "conversations.replies",
        { channel: args.link.slack_channel_id, ts: input.slack_ts, limit: 100 },
      );
      for (const reply of (replies.messages ?? []).slice(1)) {
        const replyInput = slackMessageFromHistory({
          message: reply,
          teamId: args.link.slack_team_id,
          channelId: args.link.slack_channel_id,
          threadTs: input.slack_ts,
        });
        if (replyInput.is_bot_message) {
          skipped++;
          continue;
        }
        const replyResult = await upsertProjectSlackEvent({
          admin: args.admin,
          link: args.link,
          message: replyInput,
        });
        threadReplies++;
        imported++;
        eventsUpserted++;
        mergePipeline(pipeline, replyResult.pipeline);
      }
    }
  }

  if (imported === 0 && skippedHistorical > 0) {
    warnings.push(
      `Skipped ${skippedHistorical} message(s) older than the channel link baseline (new messages only).`,
    );
  } else if (imported === 0) {
    warnings.push("No Slack messages imported. Confirm the bot is in this channel and messages exist.");
  } else if (pipeline.meaningful_signals_count === 0) {
    warnings.push("Slack messages imported but none were classified as meaningful signals during import.");
  }

  const reprocess = await reprocessSlackEventsForProject({
    admin: args.admin,
    projectId: args.link.project_id,
    projectSlackLinkId: args.link.id,
  });
  mergeReprocessIntoAggregate(
    {
      signals_upserted_count: pipeline.signals_upserted_count,
      meaningful_signals_count: pipeline.meaningful_signals_count,
      signal_threads_upserted_count: pipeline.signal_threads_upserted_count,
      jobs_queued_count: pipeline.jobs_queued_count,
      warnings,
      latest_messages_preview: previews,
    },
    reprocess,
  );

  await args.admin
    .from("project_slack_links")
    .update({
      last_synced_at: new Date().toISOString(),
      last_event_ts: latestTs,
      last_error: null,
    })
    .eq("id", args.link.id);

  return {
    imported_count: imported,
    thread_replies_imported_count: threadReplies,
    skipped_count: skipped,
    events_upserted_count: eventsUpserted,
    signals_upserted_count: Math.max(pipeline.signals_upserted_count, reprocess.signals_upserted),
    meaningful_signals_count: Math.max(pipeline.meaningful_signals_count, reprocess.meaningful_signals),
    signal_threads_upserted_count: Math.max(pipeline.signal_threads_upserted_count, reprocess.threads_upserted),
    jobs_queued_count: Math.max(pipeline.jobs_queued_count, reprocess.jobs_queued),
    latest_messages_preview: previews.slice(-10),
    warnings,
    reprocess,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let body: { project_id?: string; project_slack_link_id?: string; limit?: number; reprocess?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");
    const limit = Math.min(Math.max(body.limit ?? 50, 10), 100);

    const admin = getServiceRoleSupabase();
    let query = admin
      .from("project_slack_links")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "active");
    if (body.project_slack_link_id) query = query.eq("id", body.project_slack_link_id);

    const { data: links, error: linksError } = await query;
    if (linksError) return err("Failed to load Slack links.", 500, "DB_ERROR", linksError.message);
    if (!links || links.length === 0) {
      return err("No active Slack channel links found for this project.", 404, "NOT_FOUND");
    }

    if (body.reprocess) {
      const reprocess = await reprocessSlackEventsForProject({
        admin,
        projectId,
        projectSlackLinkId: body.project_slack_link_id?.trim(),
        force: body.force === true,
      });
      return json({
        imported_count: 0,
        thread_replies_imported_count: 0,
        skipped_count: 0,
        events_upserted_count: reprocess.events_checked,
        signals_upserted_count: reprocess.signals_upserted,
        meaningful_signals_count: reprocess.meaningful_signals,
        signal_threads_upserted_count: reprocess.threads_upserted,
        jobs_queued_count: reprocess.jobs_queued,
        latest_messages_preview: reprocess.previews.slice(0, 10).map((preview) => ({
          text: preview.text,
          signal_type: preview.signal_type,
          priority: preview.priority,
          thread_key: preview.thread_key,
          include_in_ai: true,
        })),
        warnings: reprocess.warnings,
        reprocessed: true,
        reprocess,
      });
    }

    const aggregate = {
      imported_count: 0,
      thread_replies_imported_count: 0,
      skipped_count: 0,
      events_upserted_count: 0,
      signals_upserted_count: 0,
      meaningful_signals_count: 0,
      signal_threads_upserted_count: 0,
      jobs_queued_count: 0,
      latest_messages_preview: [] as Array<{
        text: string;
        signal_type: string;
        priority: string;
        thread_key: string;
        include_in_ai: boolean;
      }>,
      warnings: [] as string[],
    };

    for (const link of links as ProjectSlackLinkRow[]) {
      const { token } = await getSlackWorkspaceTokenOrThrow(admin, link.slack_team_id);
      try {
        const result = await syncLink({
          admin,
          link: link as ProjectSlackLinkRow & { slack_channel_id: string; slack_team_id: string },
          token,
          limit,
        });
        aggregate.imported_count += result.imported_count;
        aggregate.thread_replies_imported_count += result.thread_replies_imported_count;
        aggregate.skipped_count += result.skipped_count;
        aggregate.events_upserted_count += result.events_upserted_count;
        aggregate.signals_upserted_count += result.signals_upserted_count;
        aggregate.meaningful_signals_count += result.meaningful_signals_count;
        aggregate.signal_threads_upserted_count += result.signal_threads_upserted_count;
        aggregate.jobs_queued_count += result.jobs_queued_count;
        aggregate.latest_messages_preview.push(...result.latest_messages_preview);
        aggregate.warnings.push(...result.warnings);
      } catch (e) {
        await admin
          .from("project_slack_links")
          .update({ last_error: (e as Error).message })
          .eq("id", link.id);
        throw e;
      }
    }

    return json(aggregate);
  } catch (e) {
    return err("Failed to sync Slack channel.", 500, "SLACK_SYNC_ERROR", (e as Error).message);
  }
});
