import { tasks } from "@trigger.dev/sdk";

import { getServiceClient } from "../server/supabase";
import { classifyGoogleSyncError } from "../lib/googleImportRecovery";

import type { GoogleSyncBatchAction } from "./googleSyncBatchTypes";
import type { BatchWorkerResult, GoogleWorkerPayload } from "./googleWorker";



export const GOOGLE_TASK_IDS = {

  initialImport: "google-initial-import",

  incrementalSync: "google-incremental-sync",

  contactsPage: "google-sync-contacts-page",

  calendarPage: "google-sync-calendar-page",

  gmailDiscoverPage: "google-discover-gmail-threads-page",

  resolveBasicEntities: "google-resolve-basic-entities",

  completeCoreSync: "google-complete-core-sync",

  filterEnrichment: "google-filter-enrichment-threads",

  groupRelationships: "google-group-relationships",

  enrichRelationshipBatch: "google-enrich-relationship-batch",

  gmailProcessBatch: "google-process-gmail-thread-batch",

  resolveEntities: "google-resolve-crm-entities",

  enrichCompanies: "google-enrich-crm-companies",

  finalizeImport: "google-finalize-import",

  reconcileStale: "reconcile-stale-google-imports",

  calendarFreshness: "google-calendar-freshness-sync",

  reconcileCrmImport: "reconcile-google-crm-import",

  calendarHistoricalRecovery: "google-calendar-historical-recovery",

} as const;



const ACTION_TO_TASK: Record<GoogleSyncBatchAction, string | undefined> = {

  validate: undefined,

  contacts_page: GOOGLE_TASK_IDS.contactsPage,

  calendar_page: GOOGLE_TASK_IDS.calendarPage,

  gmail_discover_page: GOOGLE_TASK_IDS.gmailDiscoverPage,

  resolve_basic_entities: GOOGLE_TASK_IDS.resolveBasicEntities,

  complete_core_sync: GOOGLE_TASK_IDS.completeCoreSync,

  filter_enrichment_threads: GOOGLE_TASK_IDS.filterEnrichment,

  group_relationships: GOOGLE_TASK_IDS.groupRelationships,

  enrich_relationship_batch: GOOGLE_TASK_IDS.enrichRelationshipBatch,

  gmail_process_batch: GOOGLE_TASK_IDS.gmailProcessBatch,

  resolve_entities: GOOGLE_TASK_IDS.resolveEntities,

  enrich_companies: GOOGLE_TASK_IDS.enrichCompanies,

  finalize: GOOGLE_TASK_IDS.finalizeImport,

  reconcile_reset: undefined,

};



type SourceProgress = {

  contacts?: { completed?: boolean };

  calendar?: { completed?: boolean };

  gmail?: {

    discovery_completed?: boolean;

    processing_completed?: boolean;

    core_metadata_completed?: boolean;

    completed?: boolean;

  };

  core?: { completed?: boolean };

  resolve?: { completed?: boolean };

  enrichment?: { filter_completed?: boolean; grouping_completed?: boolean; completed?: boolean; paused?: boolean };

  enrich?: { completed?: boolean };

};



type ImportContext = {

  sources: string[];

  sourceProgress: SourceProgress;

  flags: Record<string, boolean>;

  status: string;

  processorVersion: number;

  coreSyncStatus: string;

  enrichmentStatus: string;

};



const TERMINAL_STATUSES = new Set(["completed", "completed_with_warnings", "failed", "cancelled", "timed_out"]);



export async function loadImportContext(importRunId: string): Promise<ImportContext> {

  const admin = getServiceClient();

  const { data: run } = await admin

    .from("google_import_runs")

    .select("sources, source_progress, status, connection_id, processor_version, core_sync_status, enrichment_status")

    .eq("id", importRunId)

    .single();



  const { data: connection } = await admin

    .from("user_google_connections")

    .select("sources_enabled")

    .eq("id", run?.connection_id)

    .single();



  return {

    sources: (run?.sources as string[]) ?? ["contacts", "calendar"],

    sourceProgress: (run?.source_progress as SourceProgress) ?? {},

    flags: (connection?.sources_enabled ?? {}) as Record<string, boolean>,

    status: run?.status ?? "queued",

    processorVersion: Number(run?.processor_version ?? 1),

    coreSyncStatus: String(run?.core_sync_status ?? "pending"),

    enrichmentStatus: String(run?.enrichment_status ?? "pending"),

  };

}


export function isSourceEnabled(source: string, flags: Record<string, boolean>): boolean {

  if (source === "contacts") return flags.contacts !== false;

  if (source === "calendar") return flags.calendar !== false;

  if (source === "gmail") return flags.gmail === true;

  return true;

}



function coreSyncIncomplete(ctx: ImportContext): boolean {

  if (ctx.coreSyncStatus === "complete") return false;

  const sp = ctx.sourceProgress;

  if (ctx.sources.includes("contacts") && isSourceEnabled("contacts", ctx.flags) && !sp.contacts?.completed) return true;

  if (ctx.sources.includes("calendar") && isSourceEnabled("calendar", ctx.flags) && !sp.calendar?.completed) return true;

  if (ctx.sources.includes("gmail") && isSourceEnabled("gmail", ctx.flags)) {

    if (!sp.gmail?.discovery_completed) return true;

    if (!sp.gmail?.core_metadata_completed) return true;

    if (!sp.resolve?.completed) return true;

    if (!sp.core?.completed) return true;

  }

  if (!ctx.sources.includes("gmail") && !sp.resolve?.completed) return true;

  return false;

}



function enrichmentIncomplete(ctx: ImportContext): boolean {

  if (ctx.enrichmentStatus === "complete" || ctx.enrichmentStatus === "skipped") return false;

  if (ctx.enrichmentStatus === "paused") return false;

  const en = ctx.sourceProgress.enrichment ?? {};

  if (en.paused) return false;

  if (!en.filter_completed) return true;

  if (!en.grouping_completed) return true;

  if (!en.completed) return true;

  if (!ctx.sourceProgress.enrich?.completed) return true;

  return false;

}



/** First incomplete batch action for resume/retry. */

export function resolveNextBatchAction(ctx: ImportContext): GoogleSyncBatchAction | null {

  const { sources, sourceProgress, flags, processorVersion } = ctx;



  if (sources.includes("contacts") && isSourceEnabled("contacts", flags) && !sourceProgress.contacts?.completed) {

    return "contacts_page";

  }

  if (sources.includes("calendar") && isSourceEnabled("calendar", flags) && !sourceProgress.calendar?.completed) {

    return "calendar_page";

  }

  if (sources.includes("gmail") && isSourceEnabled("gmail", flags)) {

    if (!sourceProgress.gmail?.discovery_completed) return "gmail_discover_page";

    if (processorVersion < 2 && !sourceProgress.gmail?.processing_completed) return "gmail_process_batch";

    if (!sourceProgress.gmail?.core_metadata_completed) return "resolve_basic_entities";

    if (!sourceProgress.resolve?.completed) return "resolve_entities";

    if (!sourceProgress.core?.completed) return "complete_core_sync";

  } else if (!sourceProgress.resolve?.completed) {

    return "resolve_entities";

  } else if (!sourceProgress.core?.completed) {

    return "complete_core_sync";

  }



  if (coreSyncIncomplete(ctx)) return null;



  if (processorVersion >= 2 && enrichmentIncomplete(ctx)) {

    const en = sourceProgress.enrichment ?? {};

    if (!en.filter_completed) return "filter_enrichment_threads";

    if (!en.grouping_completed) return "group_relationships";

    if (!en.completed) return "enrich_relationship_batch";

    if (!sourceProgress.enrich?.completed) return "enrich_companies";

  }



  return "finalize";

}



export function resolveNextBatchActionAfter(

  completedAction: GoogleSyncBatchAction,

  ctx: ImportContext,

): GoogleSyncBatchAction | null {

  const order: GoogleSyncBatchAction[] = [

    "validate",

    "contacts_page",

    "calendar_page",

    "gmail_discover_page",

    "gmail_process_batch",

    "resolve_basic_entities",

    "resolve_entities",

    "complete_core_sync",

    "filter_enrichment_threads",

    "group_relationships",

    "enrich_relationship_batch",

    "enrich_companies",

    "finalize",

  ];



  const idx = order.indexOf(completedAction);

  for (let i = idx + 1; i < order.length; i++) {

    const candidate = order[i]!;

    if (candidate === "contacts_page" && (!ctx.sources.includes("contacts") || !isSourceEnabled("contacts", ctx.flags))) continue;

    if (candidate === "calendar_page" && (!ctx.sources.includes("calendar") || !isSourceEnabled("calendar", ctx.flags))) continue;

    if ((candidate === "gmail_discover_page" || candidate === "gmail_process_batch" || candidate === "resolve_basic_entities")

      && (!ctx.sources.includes("gmail") || !isSourceEnabled("gmail", ctx.flags))) continue;

    if (candidate === "gmail_process_batch" && ctx.processorVersion >= 2) continue;

    if (["filter_enrichment_threads", "group_relationships", "enrich_relationship_batch"].includes(candidate)

      && (ctx.processorVersion < 2 || ctx.enrichmentStatus === "paused" || ctx.enrichmentStatus === "skipped")) continue;

    if (candidate === "complete_core_sync" && ctx.coreSyncStatus === "complete") continue;

    if (candidate === "resolve_entities" && ctx.sourceProgress.resolve?.completed) continue;

    if (candidate === "enrich_companies" && ctx.sourceProgress.enrich?.completed) continue;

    if (candidate === "filter_enrichment_threads" && ctx.sourceProgress.enrichment?.filter_completed) continue;

    if (candidate === "group_relationships" && ctx.sourceProgress.enrichment?.grouping_completed) continue;

    if (candidate === "enrich_relationship_batch" && ctx.sourceProgress.enrichment?.completed) continue;

    return candidate;

  }

  return null;

}



export async function scheduleGoogleTask(

  taskId: string,

  payload: GoogleWorkerPayload,

  idempotencyKey: string,

): Promise<string> {

  const handle = await tasks.trigger(taskId, payload, { idempotencyKey });

  const runId = typeof handle === "object" && handle && "id" in handle ? String(handle.id) : String(handle);

  await getServiceClient()

    .from("google_import_runs")

    .update({ last_heartbeat_at: new Date().toISOString(), trigger_run_id: runId })

    .eq("id", payload.import_run_id);

  return runId;

}



export async function scheduleBatchContinuation(

  action: GoogleSyncBatchAction,

  payload: GoogleWorkerPayload,

  suffix: string,

): Promise<void> {

  const taskId = ACTION_TO_TASK[action];

  if (!taskId) throw new Error(`No Trigger task mapped for action ${action}`);

  await scheduleGoogleTask(taskId, payload, `google:${payload.import_run_id}:${action}:${suffix}`);

}



export async function handleBatchCompletion(

  payload: GoogleWorkerPayload,

  action: GoogleSyncBatchAction,

  result: BatchWorkerResult,

  triggerRunId: string,

): Promise<void> {

  const ctx = await loadImportContext(payload.import_run_id);

  if (ctx.status === "cancelled" || TERMINAL_STATUSES.has(ctx.status)) return;



  if (!result.done) {

    await scheduleBatchContinuation(action, payload, `page:${Date.now()}`);

    return;

  }



  const next = resolveNextBatchActionAfter(action, ctx);

  if (next) {

    await scheduleBatchContinuation(next, payload, `stage:${next}`);

    return;

  }



  await scheduleBatchContinuation("finalize", payload, "final");

  void triggerRunId;

}



export async function markImportRunFailure(

  importRunId: string,

  error: { message: string; code: string },

  triggerRunId?: string,

  failedStage?: string,

  status: "failed" | "timed_out" = "failed",

): Promise<void> {

  const admin = getServiceClient();

  const now = new Date().toISOString();

  const { data: current } = await admin
    .from("google_import_runs")
    .select("import_history, retry_count, progress_stage")
    .eq("id", importRunId)
    .maybeSingle();
  const history = Array.isArray(current?.import_history) ? [...current.import_history] : [];
  const classification = classifyGoogleSyncError(error.code, error.message);

  if (classification === "recoverable") {
    const retryCount = Number(current?.retry_count ?? 0) + 1;
    history.push({
      at: now,
      event: "retry_scheduled",
      detail: error.message.slice(0, 500),
    });
    await admin
      .from("google_import_runs")
      .update({
        status: "running",
        progress_stage: failedStage === "complete_core_sync" ? "completing_core_sync" : (current?.progress_stage ?? "running"),
        ...(failedStage === "complete_core_sync" ? { core_sync_status: "running" } : {}),
        failed_stage: failedStage ?? null,
        error: error.message.slice(0, 500),
        error_code: error.code,
        action_required: false,
        recovery_status: "retrying",
        retry_count: retryCount,
        retry_task_run_id: triggerRunId ?? undefined,
        ...(failedStage === "complete_core_sync" ? { finalization_heartbeat_at: now } : {}),
        last_historical_error_code: error.code,
        last_historical_error_message: error.message.slice(0, 500),
        import_history: history,
        last_heartbeat_at: now,
        trigger_run_id: triggerRunId ?? undefined,
      })
      .eq("id", importRunId)
      .in("status", ["queued", "starting", "running", "waiting", "failed", "timed_out"]);
    return;
  }

  history.push({
    at: now,
    event: "interrupted",
    detail: error.message.slice(0, 500),
  });

  await admin

    .from("google_import_runs")

    .update({

      status,

      progress_stage: "failed",

      failed_stage: failedStage ?? null,

      error: error.message.slice(0, 500),

      error_code: error.code,

      last_historical_error_code: error.code,

      last_historical_error_message: error.message.slice(0, 500),

      failed_at: now,

      completed_at: now,

      last_heartbeat_at: now,

      action_required: true,

      recovery_status: "needs_attention",

      trigger_run_id: triggerRunId ?? undefined,

      import_history: history,

    })

    .eq("id", importRunId)

    .in("status", ["queued", "starting", "running", "waiting"]);

}



export function isTimeoutError(error: unknown): boolean {

  const msg = error instanceof Error ? error.message : String(error);

  return /MAX_DURATION_EXCEEDED|maxDuration|timed out|timeout/i.test(msg);

}



export async function handleGoogleTaskError(

  payload: GoogleWorkerPayload,

  error: unknown,

  triggerRunId: string,

  stage?: string,

): Promise<never> {

  const message = error instanceof Error ? error.message : "Synchronization failed.";

  const code = isTimeoutError(error) ? "MAX_DURATION_EXCEEDED" : "SYNC_FAILED";

  await markImportRunFailure(

    payload.import_run_id,

    { message, code },

    triggerRunId,

    stage,

    isTimeoutError(error) ? "timed_out" : "failed",

  );

  throw error instanceof Error ? error : new Error(message);
}
