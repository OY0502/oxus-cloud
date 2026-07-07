import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueAnalyzeProjectSignalsJob, syncIncrementalSlackEventsForProject } from "./projectSignalPipeline.ts";
import { isMeaningfulSlackSignal } from "./slackSignalClassification.ts";
import { processSlackThreadIntelligenceForProject } from "./slackPmActions.ts";
import type { SuppressionReason } from "./pmActionSuppression.ts";

export type ProcessAiJobsResult = {
  processed_count: number;
  failed_count: number;
  actions_created_count: number;
  actions_updated_count: number;
  actions_auto_resolved_count: number;
  actions_skipped_count: number;
  actions_suppressed_count: number;
  timeline_events_created_count: number;
  timeline_events_updated_count: number;
  threads_checked: number;
  duplicates_avoided: number;
  noise_skipped_count: number;
  signals_checked: number;
  signals_new: number;
  signals_already_processed: number;
  reasons: string[];
  job_ids: string[];
  suppression_reasons: SuppressionReason[];
};

type ProjectSignal = {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  body: string | null;
  signal_type: string;
  priority: string;
  thread_key: string;
  action_key: string | null;
  signal_status: string;
  metadata: Record<string, unknown>;
  source_id: string | null;
};

async function processAnalyzeProjectSignalsJob(args: {
  admin: SupabaseClient;
  job: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<{
  actions_created: number;
  actions_updated: number;
  actions_auto_resolved: number;
  actions_skipped: number;
  actions_suppressed: number;
  timeline_events_created: number;
  timeline_events_updated: number;
  threads_checked: number;
  duplicates_avoided: number;
  noise_skipped: number;
  signals_checked: number;
  signals_new: number;
  signals_already_processed: number;
  reasons: string[];
  suppression_reasons: SuppressionReason[];
}> {
  const projectId = String(args.job.project_id);
  const payload = (args.job.payload ?? {}) as Record<string, unknown>;
  const signalIds = Array.isArray(payload.signal_ids)
    ? payload.signal_ids.filter((id): id is string => typeof id === "string")
    : [];

  let query = args.admin
    .from("project_signals")
    .select("*")
    .eq("project_id", projectId)
    .in("signal_status", ["new", "processing"]);

  if (signalIds.length > 0) query = query.in("id", signalIds);

  const { data: signals, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (signals ?? []) as ProjectSignal[];
  const reasons: string[] = [];
  let noiseSkipped = 0;

  for (const signal of rows) {
    if (!isMeaningfulSlackSignal(signal.signal_type)) {
      await args.admin
        .from("project_signals")
        .update({ signal_status: "ignored", processed_at: new Date().toISOString() })
        .eq("id", signal.id);
      noiseSkipped++;
      reasons.push(`ignored:${signal.signal_type}`);
    }
  }

  const meaningfulRows = rows.filter((row) => isMeaningfulSlackSignal(row.signal_type));

  if (meaningfulRows.length === 0) {
    if (rows.length === 0) reasons.push("no_pending_signals");
    else reasons.push("no_meaningful_signals");
    return {
      actions_created: 0,
      actions_updated: 0,
      actions_auto_resolved: 0,
      actions_skipped: noiseSkipped,
      actions_suppressed: 0,
      timeline_events_created: 0,
      timeline_events_updated: 0,
      threads_checked: 0,
      duplicates_avoided: 0,
      noise_skipped: noiseSkipped,
      signals_checked: rows.length,
      signals_new: 0,
      signals_already_processed: rows.length,
      reasons,
      suppression_reasons: [],
    };
  }

  const threadResult = await processSlackThreadIntelligenceForProject({
    admin: args.admin,
    projectId,
    createdBy: args.createdBy,
  });

  for (const signal of meaningfulRows) {
    const metadata = signal.metadata ?? {};
    const wasSuppressed = threadResult.suppression_reasons.some(
      (r) => r.thread_key === signal.thread_key,
    );
    await args.admin
      .from("project_signals")
      .update({
        signal_status: wasSuppressed ? "ignored" : "processed",
        processed_at: new Date().toISOString(),
        metadata: {
          ...metadata,
          ...(wasSuppressed
            ? { suppression_reason: "suppressed_by_dismissed_action" }
            : { processing_reason: "processed_by_analyze_job" }),
        },
      })
      .eq("id", signal.id);
  }

  return {
    actions_created: threadResult.actions_created,
    actions_updated: threadResult.actions_updated,
    actions_auto_resolved: threadResult.actions_auto_resolved,
    actions_skipped: noiseSkipped,
    actions_suppressed: threadResult.actions_suppressed,
    timeline_events_created: threadResult.timeline_events_created,
    timeline_events_updated: threadResult.timeline_events_updated,
    threads_checked: threadResult.threads_checked,
    duplicates_avoided: threadResult.duplicates_avoided,
    noise_skipped: noiseSkipped,
    signals_checked: rows.length,
    signals_new: meaningfulRows.length,
    signals_already_processed: 0,
    reasons: [...reasons, ...threadResult.reasons],
    suppression_reasons: threadResult.suppression_reasons,
  };
}

export async function processAiJobsForProject(args: {
  admin: SupabaseClient;
  projectId?: string;
  createdBy?: string | null;
  limit?: number;
}): Promise<ProcessAiJobsResult> {
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
  let query = args.admin
    .from("ai_processing_jobs")
    .select("*")
    .eq("status", "queued")
    .eq("job_type", "analyze_project_signals")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (args.projectId) query = query.eq("project_id", args.projectId);

  const { data: jobs, error } = await query;
  if (error) throw new Error(error.message);

  const result: ProcessAiJobsResult = {
    processed_count: 0,
    failed_count: 0,
    actions_created_count: 0,
    actions_updated_count: 0,
    actions_auto_resolved_count: 0,
    actions_skipped_count: 0,
    actions_suppressed_count: 0,
    timeline_events_created_count: 0,
    timeline_events_updated_count: 0,
    threads_checked: 0,
    duplicates_avoided: 0,
    noise_skipped_count: 0,
    signals_checked: 0,
    signals_new: 0,
    signals_already_processed: 0,
    reasons: [],
    job_ids: [],
    suppression_reasons: [],
  };

  if (!jobs || jobs.length === 0) {
    result.reasons.push("no_queued_jobs");
    return result;
  }

  for (const job of jobs) {
    const startedAt = new Date().toISOString();
    await args.admin
      .from("ai_processing_jobs")
      .update({ status: "running", started_at: startedAt })
      .eq("id", job.id);

    try {
      const jobResult = await processAnalyzeProjectSignalsJob({
        admin: args.admin,
        job,
        createdBy: args.createdBy,
      });
      result.processed_count++;
      result.actions_created_count += jobResult.actions_created;
      result.actions_updated_count += jobResult.actions_updated;
      result.actions_auto_resolved_count += jobResult.actions_auto_resolved;
      result.actions_skipped_count += jobResult.actions_skipped;
      result.actions_suppressed_count += jobResult.actions_suppressed;
      result.timeline_events_created_count += jobResult.timeline_events_created;
      result.timeline_events_updated_count += jobResult.timeline_events_updated;
      result.threads_checked += jobResult.threads_checked;
      result.duplicates_avoided += jobResult.duplicates_avoided;
      result.noise_skipped_count += jobResult.noise_skipped;
      result.signals_checked += jobResult.signals_checked;
      result.signals_new += jobResult.signals_new;
      result.signals_already_processed += jobResult.signals_already_processed;
      result.reasons.push(...jobResult.reasons);
      result.job_ids.push(job.id);
      result.suppression_reasons.push(...jobResult.suppression_reasons);

      await args.admin
        .from("ai_processing_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          result: jobResult,
        })
        .eq("id", job.id);
    } catch (e) {
      result.failed_count++;
      result.reasons.push((e as Error).message);
      await args.admin
        .from("ai_processing_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: (e as Error).message,
        })
        .eq("id", job.id);
    }
  }

  return result;
}

export async function ensureSlackSignalsProcessed(args: {
  admin: SupabaseClient;
  projectId: string;
  createdBy?: string | null;
}): Promise<ProcessAiJobsResult> {
  const { count: eventCount, error: eventCountError } = await args.admin
    .from("project_slack_events")
    .select("*", { count: "exact", head: true })
    .eq("project_id", args.projectId);
  if (eventCountError) throw new Error(eventCountError.message);

  const result: ProcessAiJobsResult = {
    processed_count: 0,
    failed_count: 0,
    actions_created_count: 0,
    actions_updated_count: 0,
    actions_auto_resolved_count: 0,
    actions_skipped_count: 0,
    actions_suppressed_count: 0,
    timeline_events_created_count: 0,
    timeline_events_updated_count: 0,
    threads_checked: 0,
    duplicates_avoided: 0,
    noise_skipped_count: 0,
    signals_checked: 0,
    signals_new: 0,
    signals_already_processed: 0,
    reasons: [],
    job_ids: [],
    suppression_reasons: [],
  };

  if ((eventCount ?? 0) > 0) {
    const incremental = await syncIncrementalSlackEventsForProject({
      admin: args.admin,
      projectId: args.projectId,
    });
    result.signals_new += incremental.signals_new;
    result.signals_already_processed += incremental.signals_already_processed;
    result.signals_checked += incremental.events_checked;
    result.reasons.push(
      `incremental_sync:${incremental.events_synced}_synced_${incremental.signals_new}_new_${incremental.signals_already_processed}_already_processed`,
    );
  }

  const { data: pendingSignals } = await args.admin
    .from("project_signals")
    .select("id, thread_key, priority")
    .eq("project_id", args.projectId)
    .eq("source_type", "slack")
    .eq("signal_status", "new")
    .limit(50);

  if (pendingSignals && pendingSignals.length > 0) {
    await enqueueAnalyzeProjectSignalsJob({
      admin: args.admin,
      projectId: args.projectId,
      signalIds: pendingSignals.map((row) => row.id),
      threadKeys: [...new Set(pendingSignals.map((row) => row.thread_key))],
      priority: pendingSignals[0]?.priority ?? "medium",
    });
  }

  const jobResult = await processAiJobsForProject({
    admin: args.admin,
    projectId: args.projectId,
    createdBy: args.createdBy,
  });

  return {
    ...jobResult,
    reasons: [...result.reasons, ...jobResult.reasons],
    actions_created_count: result.actions_created_count + jobResult.actions_created_count,
    actions_updated_count: result.actions_updated_count + jobResult.actions_updated_count,
    actions_auto_resolved_count: result.actions_auto_resolved_count + jobResult.actions_auto_resolved_count,
    actions_suppressed_count: result.actions_suppressed_count + (jobResult.actions_suppressed_count ?? 0),
    timeline_events_created_count:
      result.timeline_events_created_count + jobResult.timeline_events_created_count,
    timeline_events_updated_count:
      result.timeline_events_updated_count + jobResult.timeline_events_updated_count,
    threads_checked: result.threads_checked + jobResult.threads_checked,
    duplicates_avoided: result.duplicates_avoided + jobResult.duplicates_avoided,
    signals_new: result.signals_new + (jobResult.signals_new ?? 0),
    signals_already_processed: result.signals_already_processed + (jobResult.signals_already_processed ?? 0),
    suppression_reasons: [...result.suppression_reasons, ...(jobResult.suppression_reasons ?? [])],
  };
}
