import { getServiceClient } from "./supabase";

import {

  GOOGLE_IMPORT_MAX_AUTO_RETRIES,

  recoveryBackoffMs,

  shouldWatchdogSkipImport,

} from "../lib/googleImportRecovery";

import { GOOGLE_TASK_IDS } from "../trigger/googleOrchestrator";

import { isTriggerDevConfigured, triggerDevTask } from "./triggerDev";



const ACTIVE_IMPORT_STATUSES = ["queued", "starting", "running", "waiting"] as const;

const ACTIVE_SOURCE_STATUSES = ["queued", "running", "waiting", "starting"] as const;

const RESUMABLE_IMPORT_STATUSES = ["failed", "timed_out"] as const;

const STALE_HEARTBEAT_MS = 25 * 60 * 1000;

const MAX_REPAIRS_PER_RUN = 5;



const ACTION_TO_TASK: Record<string, string> = {

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

};



type StaleRunRow = {

  id: string;

  connection_id: string;

  owner_user_id: string;

  correlation_id: string | null;

  status: string;

  progress_stage: string | null;

  core_sync_status: string | null;

  enrichment_status: string | null;

  last_heartbeat_at: string | null;

  trigger_run_id: string | null;

  retry_task_run_id: string | null;

  retry_count: number | null;

  recovery_status: string | null;

  next_retry_at: string | null;

  finalization_heartbeat_at: string | null;

  action_required: boolean | null;

  last_reconciled_at: string | null;

  last_reconciliation_outcome: string | null;

  counts: Record<string, unknown> | null;

  source_progress: Record<string, unknown> | null;

  processor_version: number | null;

};



function heartbeatAgeMs(at?: string | null): number | null {

  if (!at) return null;

  const ts = new Date(at).getTime();

  if (Number.isNaN(ts)) return null;

  return Date.now() - ts;

}



async function hasActiveSourceRuns(admin: ReturnType<typeof getServiceClient>, importRunId: string): Promise<boolean> {

  const { data } = await admin

    .from("google_import_source_runs")

    .select("status, last_heartbeat_at")

    .eq("import_run_id", importRunId)

    .in("status", [...ACTIVE_SOURCE_STATUSES]);

  return (data ?? []).some((row) => {

    const age = heartbeatAgeMs(row.last_heartbeat_at as string | null);

    return age == null || age <= STALE_HEARTBEAT_MS;

  });

}



function resolveRecoveryAction(run: StaleRunRow): string | null {

  const sourceProgress = (run.source_progress ?? {}) as Record<string, Record<string, unknown>>;

  if (run.core_sync_status === "complete") {

    if (run.enrichment_status === "running") return "filter_enrichment_threads";

    return "finalize";

  }

  if (sourceProgress.resolve?.completed && !sourceProgress.core?.completed) {

    return "complete_core_sync";

  }

  return null;

}



async function queueRecoveryTask(run: StaleRunRow, action: string): Promise<string | null> {

  if (!isTriggerDevConfigured()) return null;

  const taskId = ACTION_TO_TASK[action];

  if (!taskId) return null;

  const payload = {

    import_run_id: run.id,

    connection_id: run.connection_id,

    user_id: run.owner_user_id,

    correlation_id: run.correlation_id ?? undefined,

  };

  const result = await triggerDevTask(taskId, payload, {

    idempotencyKey: `google-recovery:${run.id}:${action}`,

  });

  return result.id;

}



async function recordReconciliation(

  admin: ReturnType<typeof getServiceClient>,

  run: StaleRunRow,

  outcome: string,

  patch: Record<string, unknown> = {},

) {

  const now = new Date().toISOString();

  if (

    run.last_reconciliation_outcome === outcome

    && run.last_reconciled_at

    && heartbeatAgeMs(run.last_reconciled_at) != null

    && heartbeatAgeMs(run.last_reconciled_at)! < 30 * 60 * 1000

  ) {

    return { mutated: false, outcome };

  }



  await admin.from("google_import_runs").update({

    ...patch,

    last_reconciled_at: now,

    last_reconciliation_outcome: outcome,

    updated_at: now,

  }).eq("id", run.id);



  return { mutated: true, outcome };

}



export async function reconcileStaleGoogleImports(options?: { staleMs?: number; reason?: string }) {

  const started = Date.now();

  const admin = getServiceClient();

  const staleMs = options?.staleMs ?? STALE_HEARTBEAT_MS;

  const cutoff = new Date(Date.now() - staleMs).toISOString();

  const metrics = {
    reason: options?.reason ?? "watchdog",
    stale_imports_found: 0,
    imports_repaired: 0,
    imports_skipped: 0,
    google_api_calls: 0,
    database_rows_read: 0,
    database_rows_written: 0,
    child_tasks: 0,
    ai_calls: 0,
    firecrawl_calls: 0,
    duration_ms: 0,
  };



  const { data: activeStale } = await admin

    .from("google_import_runs")

    .select([

      "id", "connection_id", "owner_user_id", "correlation_id", "status", "progress_stage",

      "core_sync_status", "enrichment_status", "last_heartbeat_at", "trigger_run_id",

      "retry_task_run_id", "retry_count", "recovery_status", "next_retry_at",

      "finalization_heartbeat_at", "action_required", "last_reconciled_at",

      "last_reconciliation_outcome", "counts", "source_progress", "processor_version",

    ].join(", "))

    .in("status", [...ACTIVE_IMPORT_STATUSES])

    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${cutoff}`)

    .limit(MAX_REPAIRS_PER_RUN);



  metrics.database_rows_read += activeStale?.length ?? 0;



  if (!activeStale?.length) {

    metrics.duration_ms = Date.now() - started;

    console.info("[reconcile-stale-google-imports] idle", metrics);

    return {

      reconciled_count: 0,

      reconciled: [],

      duration_ms: metrics.duration_ms,

      candidates: 0,

      metrics,

    };

  }



  metrics.stale_imports_found = activeStale.length;



  const { data: resumableRuns } = await admin

    .from("google_import_runs")

    .select([

      "id", "connection_id", "owner_user_id", "correlation_id", "status", "progress_stage",

      "core_sync_status", "enrichment_status", "last_heartbeat_at", "trigger_run_id",

      "retry_task_run_id", "retry_count", "recovery_status", "next_retry_at",

      "finalization_heartbeat_at", "action_required", "last_reconciled_at",

      "last_reconciliation_outcome", "counts", "source_progress", "processor_version",

    ].join(", "))

    .in("status", [...RESUMABLE_IMPORT_STATUSES])

    .in("recovery_status", ["recovering", "idle", "needs_attention"])

    .limit(MAX_REPAIRS_PER_RUN);



  metrics.database_rows_read += resumableRuns?.length ?? 0;



  const candidateRuns = ([...(activeStale ?? []), ...(resumableRuns ?? [])] as unknown) as StaleRunRow[];

  const uniqueRuns = candidateRuns.filter((row, index, all) => all.findIndex((other) => other.id === row.id) === index);



  const reconciled: Array<{ import_run_id: string; outcome: string; mutated: boolean }> = [];

  let repairs = 0;



  for (const run of uniqueRuns) {

    if (repairs >= MAX_REPAIRS_PER_RUN) break;



    const age = heartbeatAgeMs(run.last_heartbeat_at);

    const isActive = ACTIVE_IMPORT_STATUSES.includes(run.status as typeof ACTIVE_IMPORT_STATUSES[number]);

    const isResumable = RESUMABLE_IMPORT_STATUSES.includes(run.status as typeof RESUMABLE_IMPORT_STATUSES[number]);



    if (shouldWatchdogSkipImport(run)) {

      const result = await recordReconciliation(admin, run, "skip_protected");

      reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

      continue;

    }



    if (isActive && age != null && age <= staleMs) {

      const result = await recordReconciliation(admin, run, "skip_recent_heartbeat");

      reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

      continue;

    }



    if (await hasActiveSourceRuns(admin, run.id)) {

      const result = await recordReconciliation(admin, run, "skip_active_source_runs");

      reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

      continue;

    }



    if (run.core_sync_status === "complete" && run.enrichment_status !== "running") {

      const now = new Date().toISOString();

      const result = await recordReconciliation(admin, run, "auto_finalize_completed", {

        status: "completed",

        progress_stage: "completed",

        completed_at: now,

        action_required: false,

        recovery_status: "idle",

        error: null,

        error_code: null,

        last_heartbeat_at: now,

      });

      reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

      if (result.mutated) repairs += 1;

      continue;

    }



    const recoveryAction = resolveRecoveryAction(run);

    const retryCount = Number(run.retry_count ?? 0);



    if ((isResumable || isActive) && recoveryAction && retryCount < GOOGLE_IMPORT_MAX_AUTO_RETRIES) {

      try {

        const triggerRunId = await queueRecoveryTask(run, recoveryAction);
        if (triggerRunId) metrics.child_tasks += 1;

        const now = new Date().toISOString();

        const result = await recordReconciliation(admin, run, "auto_recovery_queued", {

          status: "running",

          progress_stage: recoveryAction === "complete_core_sync" ? "completing_core_sync" : run.progress_stage,

          core_sync_status: recoveryAction === "complete_core_sync" ? "running" : run.core_sync_status,

          error_code: null,

          error: null,

          failed_at: null,

          completed_at: null,

          failed_stage: null,

          action_required: false,

          recovery_status: "recovering",

          retry_count: retryCount + 1,

          retry_task_run_id: triggerRunId,

          next_retry_at: new Date(Date.now() + recoveryBackoffMs(retryCount + 1)).toISOString(),

          finalization_heartbeat_at: recoveryAction === "complete_core_sync" ? now : run.finalization_heartbeat_at,

          last_heartbeat_at: now,

          trigger_run_id: triggerRunId ?? run.trigger_run_id,

        });

        reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

        if (result.mutated) repairs += 1;

        continue;

      } catch {

        // fall through to attention state if queue fails

      }

    }



    if (!isActive && !isResumable) {

      const result = await recordReconciliation(admin, run, "skip_terminal");

      reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

      continue;

    }



    if (retryCount >= GOOGLE_IMPORT_MAX_AUTO_RETRIES) {

      const now = new Date().toISOString();

      const result = await recordReconciliation(admin, run, "needs_attention", {

        status: "timed_out",

        progress_stage: "failed",

        action_required: true,

        recovery_status: "needs_attention",

        error_code: "RETRY_BUDGET_EXHAUSTED",

        error: "Import needs attention after automatic recovery attempts were exhausted.",

        failed_at: now,

        completed_at: now,

        last_heartbeat_at: now,

      });

      reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

      if (result.mutated) repairs += 1;

      continue;

    }



    const now = new Date().toISOString();

    const message = "Sync interrupted. Automatic recovery will continue from the saved checkpoint.";

    const result = await recordReconciliation(admin, run, "stale_marked_attention", {

      status: "timed_out",

      progress_stage: "failed",

      error_code: "STALE_RUN_RECONCILED",

      error: message,

      last_historical_error_code: "STALE_RUN_RECONCILED",

      last_historical_error_message: message,

      action_required: true,

      recovery_status: "needs_attention",

      failed_at: now,

      completed_at: now,

      last_heartbeat_at: now,

    });

    reconciled.push({ import_run_id: run.id, outcome: result.outcome, mutated: result.mutated });

    if (result.mutated) repairs += 1;

  }



  metrics.imports_repaired = reconciled.filter((row) => row.mutated).length;
  metrics.imports_skipped = reconciled.filter((row) => !row.mutated).length;
  metrics.database_rows_written = metrics.imports_repaired + metrics.imports_skipped;
  metrics.duration_ms = Date.now() - started;
  console.info("[reconcile-stale-google-imports] completed", metrics);

  return {

    reconciled_count: metrics.imports_repaired,

    reconciled,

    duration_ms: metrics.duration_ms,

    candidates: uniqueRuns.length,

    metrics,

  };

}



export async function reconcileImportRunIfStale(importRunId: string) {

  const admin = getServiceClient();

  const { data: run } = await admin

    .from("google_import_runs")

    .select("id, status, last_heartbeat_at")

    .eq("id", importRunId)

    .maybeSingle();



  if (!run || ![...ACTIVE_IMPORT_STATUSES, ...RESUMABLE_IMPORT_STATUSES].includes(run.status)) {

    return { reconciled: false };

  }



  const heartbeat = run.last_heartbeat_at ? new Date(run.last_heartbeat_at).getTime() : 0;

  if (Date.now() - heartbeat < STALE_HEARTBEAT_MS && ACTIVE_IMPORT_STATUSES.includes(run.status)) {

    return { reconciled: false };

  }



  await reconcileStaleGoogleImports();

  return { reconciled: true };

}

