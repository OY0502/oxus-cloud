import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getSlackWorkspaceTokenOrThrow } from "../_shared/slack-auth.ts";
import {
  assertInternalOxusUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
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
import { buildSlackThreadKey, type SignalPipelineStats } from "../_shared/projectSignalPipeline.ts";
import { syncSlackThreadKnowledge } from "../_shared/slackKnowledgeMemory.ts";

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
  const importedThreadKeys = new Set<string>();
  let latestTs: string | null = args.link.last_event_ts ?? null;

  const linkMetadata = args.link.metadata && typeof args.link.metadata === "object"
    ? args.link.metadata
    : {};
  const boundedBackfill = args.link.sync_mode === "bounded_history"
    && linkMetadata.history_backfill_complete !== true;
  const savedCursor = boundedBackfill && typeof linkMetadata.history_cursor === "string"
    ? linkMetadata.history_cursor.trim()
    : "";

  const historyMessages: Array<Record<string, unknown>> = [];
  let historyCursor: string | undefined = savedCursor || undefined;
  let nextHistoryCursor: string | undefined;
  let historyPages = 0;
  do {
    const remaining = Math.max(args.limit - historyMessages.length, 1);
    const history = await callSlackApi<{
      messages?: Array<Record<string, unknown>>;
      response_metadata?: { next_cursor?: string };
    }>(
      args.token,
      "conversations.history",
      {
        channel: args.link.slack_channel_id,
        oldest: boundedBackfill
          ? args.link.ingest_from_ts ?? undefined
          : args.link.last_event_ts ?? args.link.ingest_from_ts ?? undefined,
        inclusive: true,
        limit: Math.min(remaining, 100),
        ...(historyCursor ? { cursor: historyCursor } : {}),
      },
    );
    historyMessages.push(...(history.messages ?? []));
    const next = history.response_metadata?.next_cursor?.trim();
    nextHistoryCursor = next || undefined;
    historyCursor = next && historyMessages.length < args.limit ? next : undefined;
    historyPages++;
  } while (historyCursor && historyPages < 5);

  const userNames = new Map<string, string>();
  try {
    const users = await callSlackApi<{ members?: Array<Record<string, unknown>> }>(args.token, "users.list", { limit: 200 });
    for (const member of users.members ?? []) {
      const id = String(member.id ?? "");
      const profile = (member.profile ?? {}) as Record<string, unknown>;
      const name = String(profile.display_name ?? profile.real_name ?? member.real_name ?? member.name ?? id).trim();
      if (id && name) userNames.set(id, name);
    }
  } catch (error) {
    warnings.push(`Slack participant names could not be enriched: ${(error as Error).message}`);
  }

  const messages = historyMessages
    .slice(0, args.limit)
    .sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
  let threadsExpanded = 0;
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
    if (input.slack_user_id) input.slack_user_name = userNames.get(input.slack_user_id) ?? input.slack_user_id;

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
    importedThreadKeys.add(buildSlackThreadKey(
      input.slack_team_id,
      input.slack_channel_id,
      input.slack_thread_ts,
      input.slack_ts,
    ));
    mergePipeline(pipeline, upsertResult.pipeline);
    if (!latestTs || Number(input.slack_ts) > Number(latestTs)) latestTs = input.slack_ts;

    const classification = classifySlackMessageText(input.message_text);
    previews.push({
      text: (input.message_text ?? "").slice(0, 200),
      signal_type: classification.signal_type,
      priority: classification.priority,
      thread_key: input.slack_thread_ts ?? input.slack_ts,
      include_in_ai: args.link.include_in_ai,
    });

    const replyCount = typeof msg.reply_count === "number" ? msg.reply_count : 0;
    if (replyCount > 0 && input.slack_ts && threadsExpanded < 20) {
      threadsExpanded++;
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
        if (replyInput.slack_user_id) {
          replyInput.slack_user_name = userNames.get(replyInput.slack_user_id) ?? replyInput.slack_user_id;
        }
        const replyResult = await upsertProjectSlackEvent({
          admin: args.admin,
          link: args.link,
          message: replyInput,
        });
        if (replyResult.result === "skipped") {
          skipped++;
          continue;
        }
        threadReplies++;
        imported++;
        eventsUpserted++;
        importedThreadKeys.add(buildSlackThreadKey(
          replyInput.slack_team_id,
          replyInput.slack_channel_id,
          replyInput.slack_thread_ts,
          replyInput.slack_ts,
        ));
        mergePipeline(pipeline, replyResult.pipeline);
      }
    }
  }
  const backfillHasMore = boundedBackfill && Boolean(nextHistoryCursor);
  if (backfillHasMore) {
    warnings.push(`Imported a bounded batch of ${historyMessages.length} Slack messages. Use Continue import to fetch the next batch.`);
  }
  if (messages.filter((message) => Number(message.reply_count ?? 0) > 0).length > threadsExpanded) {
    warnings.push("Some older Slack threads were not expanded in this pass to keep the sync bounded and rate-limit safe.");
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
  if (savedCursor && importedThreadKeys.size > 0) {
    try {
      const historicalKnowledge = await syncSlackThreadKnowledge({
        admin: args.admin,
        projectId: args.link.project_id,
        projectSlackLinkId: args.link.id,
        threadKeys: [...importedThreadKeys],
        limit: 2000,
      });
      reprocess.knowledge.sources_created += historicalKnowledge.sources_created;
      reprocess.knowledge.sources_updated += historicalKnowledge.sources_updated;
      reprocess.knowledge.sources_unchanged += historicalKnowledge.sources_unchanged;
      reprocess.knowledge.sources_skipped += historicalKnowledge.sources_skipped;
      reprocess.knowledge.threads_checked += historicalKnowledge.threads_checked;
      reprocess.knowledge.source_ids = [...new Set([
        ...reprocess.knowledge.source_ids,
        ...historicalKnowledge.source_ids,
      ])];
    } catch (error) {
      warnings.push(`Older Slack memory extraction needs a retry: ${(error as Error).message}`);
    }
  }
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
      metadata: {
        ...linkMetadata,
        ...(boundedBackfill ? {
          history_cursor: nextHistoryCursor ?? null,
          history_backfill_complete: !backfillHasMore,
          history_backfill_last_run_at: new Date().toISOString(),
        } : {}),
      },
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
    knowledge_sources_created_count: reprocess.knowledge.sources_created,
    knowledge_sources_updated_count: reprocess.knowledge.sources_updated,
    knowledge_sources_unchanged_count: reprocess.knowledge.sources_unchanged,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    let auth;
    try {
      auth = await assertInternalOxusUser(req);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    let body: {
      project_id?: string;
      project_slack_link_id?: string;
      limit?: number;
      reprocess?: boolean;
      force?: boolean;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");
    const limit = Math.min(Math.max(body.limit ?? 100, 15), 500);

    const admin = getServiceRoleSupabase();

    {
      const {
        getProjectArchiveState,
        isProjectArchived,
        PROJECT_ARCHIVED_SKIP_MESSAGE,
      } = await import("../_shared/projectArchive.ts");
      const archiveCheck = await getProjectArchiveState(admin, projectId);
      if (isProjectArchived(archiveCheck) && body.reprocess !== true) {
        console.log(`[slack-sync-project-channel] ${PROJECT_ARCHIVED_SKIP_MESSAGE}`);
        return json({
          skipped: true,
          reason: PROJECT_ARCHIVED_SKIP_MESSAGE,
          imported_count: 0,
          thread_replies_imported_count: 0,
          skipped_count: 0,
          events_upserted_count: 0,
          signals_upserted_count: 0,
          meaningful_signals_count: 0,
          signal_threads_upserted_count: 0,
          jobs_queued_count: 0,
          latest_messages_preview: [],
          warnings: [PROJECT_ARCHIVED_SKIP_MESSAGE],
          knowledge_sources_created_count: 0,
          knowledge_sources_updated_count: 0,
          knowledge_sources_unchanged_count: 0,
        });
      }
    }

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
        knowledge_sources_created_count: reprocess.knowledge.sources_created,
        knowledge_sources_updated_count: reprocess.knowledge.sources_updated,
        knowledge_sources_unchanged_count: reprocess.knowledge.sources_unchanged,
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
      knowledge_sources_created_count: 0,
      knowledge_sources_updated_count: 0,
      knowledge_sources_unchanged_count: 0,
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
        aggregate.knowledge_sources_created_count += result.knowledge_sources_created_count;
        aggregate.knowledge_sources_updated_count += result.knowledge_sources_updated_count;
        aggregate.knowledge_sources_unchanged_count += result.knowledge_sources_unchanged_count;
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
