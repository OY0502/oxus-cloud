import { task, schedules } from "@trigger.dev/sdk";



import {

  invokeGoogleSyncWorkerBatch,

  type GoogleWorkerPayload,

} from "./googleWorker";

import {

  GOOGLE_TASK_IDS,

  handleBatchCompletion,

  handleGoogleTaskError,

  loadImportContext,

  resolveNextBatchAction,

  scheduleBatchContinuation,

} from "./googleOrchestrator";

import type { GoogleSyncBatchAction } from "./googleSyncBatchTypes";



const QUEUES = {

  discovery: { name: "google-import-discovery", concurrencyLimit: 4 },

  normalization: { name: "google-import-normalization", concurrencyLimit: 8 },

  ai: { name: "google-import-ai", concurrencyLimit: 4 },

  enrichment: { name: "google-import-enrichment", concurrencyLimit: 3 },

} as const;



async function runSingleBatchTask(

  payload: GoogleWorkerPayload,

  action: GoogleSyncBatchAction,

  triggerRunId: string,

) {

  try {

    const result = await invokeGoogleSyncWorkerBatch(payload, action, triggerRunId);

    await handleBatchCompletion(payload, action, result, triggerRunId);

    return result;

  } catch (error) {

    return handleGoogleTaskError(payload, error, triggerRunId, action);

  }

}



async function startImportOrchestration(payload: GoogleWorkerPayload, triggerRunId: string) {

  await invokeGoogleSyncWorkerBatch(payload, "validate", triggerRunId);

  const ctx = await loadImportContext(payload.import_run_id);

  const next = resolveNextBatchAction(ctx);

  if (!next) {

    await scheduleBatchContinuation("finalize", payload, "empty");

    return { orchestrated: true, next: "finalize" };

  }

  await scheduleBatchContinuation(next, payload, `start:${next}`);

  return { orchestrated: true, next };

}



export const googleInitialImportTask = task({

  id: GOOGLE_TASK_IDS.initialImport,

  queue: QUEUES.discovery,

  run: async (payload: GoogleWorkerPayload, { ctx }) => {

    try {

      return await startImportOrchestration(payload, ctx.run.id);

    } catch (error) {

      return handleGoogleTaskError(payload, error, ctx.run.id, "orchestrate");

    }

  },

});



export const googleIncrementalSyncTask = task({

  id: GOOGLE_TASK_IDS.incrementalSync,

  queue: QUEUES.discovery,

  run: async (payload: GoogleWorkerPayload, { ctx }) => {

    try {

      return await startImportOrchestration(payload, ctx.run.id);

    } catch (error) {

      return handleGoogleTaskError(payload, error, ctx.run.id, "orchestrate");

    }

  },

});



export const googleSyncContactsPageTask = task({

  id: GOOGLE_TASK_IDS.contactsPage,

  queue: QUEUES.normalization,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "contacts_page", ctx.run.id),

});



export const googleSyncCalendarPageTask = task({

  id: GOOGLE_TASK_IDS.calendarPage,

  queue: QUEUES.normalization,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "calendar_page", ctx.run.id),

});



export const googleDiscoverGmailThreadsPageTask = task({

  id: GOOGLE_TASK_IDS.gmailDiscoverPage,

  queue: QUEUES.discovery,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "gmail_discover_page", ctx.run.id),

});



export const googleResolveBasicEntitiesTask = task({

  id: GOOGLE_TASK_IDS.resolveBasicEntities,

  queue: QUEUES.normalization,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "resolve_basic_entities", ctx.run.id),

});



export const googleCompleteCoreSyncTask = task({

  id: GOOGLE_TASK_IDS.completeCoreSync,

  queue: QUEUES.normalization,

  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "complete_core_sync", ctx.run.id),

});



export const googleFilterEnrichmentThreadsTask = task({

  id: GOOGLE_TASK_IDS.filterEnrichment,

  queue: QUEUES.enrichment,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "filter_enrichment_threads", ctx.run.id),

});



export const googleGroupRelationshipsTask = task({

  id: GOOGLE_TASK_IDS.groupRelationships,

  queue: QUEUES.enrichment,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "group_relationships", ctx.run.id),

});



export const googleEnrichRelationshipBatchTask = task({

  id: GOOGLE_TASK_IDS.enrichRelationshipBatch,

  queue: QUEUES.ai,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "enrich_relationship_batch", ctx.run.id),

});



export const googleProcessGmailThreadBatchTask = task({

  id: GOOGLE_TASK_IDS.gmailProcessBatch,

  queue: QUEUES.ai,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "gmail_process_batch", ctx.run.id),

});



export const googleResolveCrmEntitiesTask = task({

  id: GOOGLE_TASK_IDS.resolveEntities,

  queue: QUEUES.normalization,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "resolve_entities", ctx.run.id),

});



export const googleEnrichCrmCompaniesTask = task({

  id: GOOGLE_TASK_IDS.enrichCompanies,

  queue: QUEUES.enrichment,

  run: async (payload: GoogleWorkerPayload, { ctx }) => runSingleBatchTask(payload, "enrich_companies", ctx.run.id),

});



export const googleFinalizeImportTask = task({

  id: GOOGLE_TASK_IDS.finalizeImport,

  queue: QUEUES.normalization,

  run: async (payload: GoogleWorkerPayload, { ctx }) => {

    try {

      return await invokeGoogleSyncWorkerBatch(payload, "finalize", ctx.run.id);

    } catch (error) {

      return handleGoogleTaskError(payload, error, ctx.run.id, "finalize");

    }

  },

});



export const reconcileGoogleCrmImportTask = task({

  id: GOOGLE_TASK_IDS.reconcileCrmImport,

  queue: QUEUES.normalization,

  run: async (payload: GoogleWorkerPayload, { ctx }) => {

    try {

      await invokeGoogleSyncWorkerBatch(payload, "reconcile_reset", ctx.run.id);

      await scheduleBatchContinuation("resolve_entities", payload, "reconcile");

      return { orchestrated: true, next: "resolve_entities" };

    } catch (error) {

      return handleGoogleTaskError(payload, error, ctx.run.id, "reconcile_reset");

    }

  },

});



export const reconcileStaleGoogleImportsTask = schedules.task({

  id: GOOGLE_TASK_IDS.reconcileStale,

  cron: {
    pattern: "0 3 * * *",
    timezone: "Europe/Lisbon",
    environments: ["PRODUCTION", "STAGING"],
  },

  run: async () => {

    const { reconcileStaleGoogleImports } = await import("../server/googleImportReconcile");

    return reconcileStaleGoogleImports({ reason: "daily_watchdog" });

  },

});



export const googleCalendarFreshnessSyncTask = task({

  id: GOOGLE_TASK_IDS.calendarFreshness,

  queue: { name: "google-calendar-freshness", concurrencyLimit: 2 },

  run: async (payload: {
    connection_id: string;
    user_id: string;
    lease_key?: string;
    sync_reason?: string;
  }, { ctx }) => {
    const { getServiceClient, invokeAgentWorker } = await import("../server/supabase");
    const admin = getServiceClient();
    const { data: connection } = await admin
      .from("user_google_connections")
      .select("*")
      .eq("id", payload.connection_id)
      .eq("user_id", payload.user_id)
      .maybeSingle();
    if (!connection) throw new Error("Google connection not found.");

    const resp = await invokeAgentWorker("google-calendar-freshness-worker", {
      connection_id: payload.connection_id,
      user_id: payload.user_id,
      lease_key: payload.lease_key,
      trigger_run_id: ctx.run.id,
      sync_reason: payload.sync_reason ?? "background",
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`google-calendar-freshness-worker failed (${resp.status}): ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  },

});



export const googleWorkerSmokeTestTask = task({

  id: "google-worker-smoke-test",

  run: async () => {

    const { invokeGoogleWorkerSmokeTest } = await import("./googleWorker");

    return invokeGoogleWorkerSmokeTest();

  },

});


