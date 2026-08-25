import type { GoogleImportRun } from "@/lib/types";



export type GoogleSyncStage =

  | "idle"

  | "queued"

  | "validating_connection"

  | "syncing_contacts"

  | "syncing_calendar"

  | "syncing_gmail"

  | "discovering_gmail_threads"

  | "processing_gmail_threads"

  | "resolving_basic_people"

  | "resolving_basic_companies"

  | "completing_core_sync"

  | "core_sync_complete"

  | "filtering_relationship_threads"

  | "analyzing_relationships"

  | "enrichment_complete"

  | "resolving_entities"

  | "resolving_people"

  | "resolving_companies"

  | "processing_relationships"

  | "creating_candidates"

  | "enriching_companies"

  | "finalizing"

  | "completed"

  | "completed_with_warnings"

  | "failed"

  | "timed_out";



export type GoogleSyncSummary = {

  companies_created: number;

  companies_updated: number;

  people_created: number;

  people_updated: number;

  candidates_created: number;

  warnings: number;

};



export type GoogleSyncStatus = {

  active: boolean;

  coreActive: boolean;

  enrichmentActive: boolean;

  coreComplete: boolean;

  stage: GoogleSyncStage;

  processed?: number;

  total?: number;

  progress_percentage?: number;

  started_at?: string;

  completed_at?: string;

  trigger_run_id?: string;

  import_run_id?: string;

  summary?: GoogleSyncSummary;

  error?: {

    code: string;

    message: string;

  };

};



const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting"]);

const CORE_STAGES = new Set([

  "queued", "validating_connection", "syncing_contacts", "syncing_calendar", "syncing_gmail",

  "discovering_gmail_threads", "resolving_basic_people", "resolving_basic_companies",

  "resolving_entities", "resolving_people", "resolving_companies",

]);



export const GOOGLE_SYNC_STAGE_LABELS: Record<GoogleSyncStage, string> = {

  idle: "Ready to sync",

  queued: "Queued",

  validating_connection: "Validating Google connection",

  syncing_contacts: "Syncing Google Contacts",

  syncing_calendar: "Syncing Calendar events",

  syncing_gmail: "Syncing Gmail",

  discovering_gmail_threads: "Discovering Gmail threads",

  processing_gmail_threads: "Processing relevant conversations",

  resolving_basic_people: "Building your CRM — resolving people",

  resolving_basic_companies: "Building your CRM — resolving companies",

  completing_core_sync: "Finishing CRM sync",

  core_sync_complete: "Google data synced",

  filtering_relationship_threads: "Filtering conversations for enrichment",

  analyzing_relationships: "Relationship enrichment continues in the background",

  enrichment_complete: "Relationship enrichment complete",

  resolving_entities: "Resolving people and companies",

  resolving_people: "Resolving people",

  resolving_companies: "Resolving companies",

  processing_relationships: "Processing relationship signals",

  creating_candidates: "Creating review candidates",

  enriching_companies: "Enriching companies",

  finalizing: "Finalizing CRM updates",

  completed: "Sync completed",

  completed_with_warnings: "Completed with warnings",

  failed: "Sync failed",

  timed_out: "Sync interrupted",

};



function sanitizeErrorMessage(raw: string | null | undefined, errorCode?: string | null): string {

  if (errorCode === "MAX_DURATION_EXCEEDED" || errorCode === "STALE_RUN_RECONCILED" || errorCode === "IDLE_TIMEOUT") {

    return raw?.trim()

      || "Google sync timed out while processing a large batch. Completed work was preserved. Retry will continue from the last checkpoint.";

  }

  if (!raw) return "Synchronization failed. Try again or reconnect Google.";

  const lower = raw.toLowerCase();

  if (lower.includes("token") || lower.includes("refresh") || lower.includes("credential") || lower.includes("bearer")) {

    return "Google authorization expired. Reconnect permissions from Manage.";

  }

  if (lower.includes("403") || lower.includes("permission") || lower.includes("insufficient")) {

    return "A Google permission was revoked or is missing.";

  }

  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;

}


function countsSummary(counts: Record<string, unknown> | null | undefined): GoogleSyncSummary {

  const c = counts ?? {};

  return {

    companies_created: Number(c.companies_created ?? 0),

    companies_updated: Number(c.companies_updated ?? 0),

    people_created: Number(c.people_created ?? 0),

    people_updated: Number(c.people_updated ?? 0),

    candidates_created: Number(c.candidates_created ?? 0),

    warnings: Number(c.warnings ?? 0),

  };

}



export function canonicalStageFromImportRun(

  run: Pick<GoogleImportRun, "status" | "progress_stage" | "core_sync_status" | "enrichment_status"> | null | undefined,

): GoogleSyncStage {

  if (!run) return "idle";

  if (run.status === "timed_out") return "failed";

  if (run.status === "failed") return "failed";

  if (run.status === "completed_with_warnings") return "completed_with_warnings";

  if (run.status === "completed") return "completed";

  const stage = run.progress_stage ?? run.status;

  const known: GoogleSyncStage[] = [

    "queued", "validating_connection", "syncing_contacts", "syncing_calendar", "syncing_gmail",

    "discovering_gmail_threads", "processing_gmail_threads",

    "resolving_basic_people", "resolving_basic_companies", "core_sync_complete",

    "filtering_relationship_threads", "analyzing_relationships", "enrichment_complete",

    "resolving_entities", "resolving_people", "resolving_companies",

    "processing_relationships", "creating_candidates", "enriching_companies", "finalizing",

  ];

  if (known.includes(stage as GoogleSyncStage)) return stage as GoogleSyncStage;

  if (run.core_sync_status === "complete" && run.enrichment_status === "running") return "analyzing_relationships";

  if (ACTIVE_STATUSES.has(run.status)) return "queued";

  return "idle";

}



export function buildGoogleSyncStatus(

  run: GoogleImportRun | null | undefined,

  connectionError?: string | null,

): GoogleSyncStatus {

  if (!run) {

    if (connectionError) {

      return {

        active: false,

        coreActive: false,

        enrichmentActive: false,

        coreComplete: false,

        stage: "failed",

        error: { code: "CONNECTION_ERROR", message: sanitizeErrorMessage(connectionError) },

      };

    }

    return { active: false, coreActive: false, enrichmentActive: false, coreComplete: false, stage: "idle" };

  }



  const stage = canonicalStageFromImportRun(run);

  const active = ACTIVE_STATUSES.has(run.status);

  const coreComplete = run.core_sync_status === "complete" || stage === "core_sync_complete";

  const enrichmentActive = active && coreComplete && (run.enrichment_status === "running" || CORE_STAGES.has(stage) === false);

  const coreActive = active && !coreComplete;



  if (run.status === "failed" || run.status === "timed_out" || stage === "failed") {

    const errorCode = run.error_code ?? (run.status === "timed_out" ? "MAX_DURATION_EXCEEDED" : "SYNC_FAILED");

    return {

      active: false,

      coreActive: false,

      enrichmentActive: false,

      coreComplete,

      stage: "failed",

      import_run_id: run.id,

      trigger_run_id: run.trigger_run_id ?? undefined,

      started_at: run.started_at ?? undefined,

      completed_at: run.completed_at ?? run.failed_at ?? undefined,

      error: { code: errorCode, message: sanitizeErrorMessage(run.error, errorCode) },

    };

  }



  const summary = countsSummary(run.counts as Record<string, unknown>);



  return {

    active,

    coreActive,

    enrichmentActive: enrichmentActive && run.enrichment_status !== "paused",

    coreComplete,

    stage,

    processed: run.progress_processed ?? undefined,

    total: run.progress_total ?? undefined,

    progress_percentage: run.progress_percentage != null ? Number(run.progress_percentage) : undefined,

    started_at: run.started_at ?? undefined,

    completed_at: run.completed_at ?? undefined,

    trigger_run_id: run.trigger_run_id ?? undefined,

    import_run_id: run.id,

    summary: !active ? summary : undefined,

  };

}



export function formatSyncProgressDetail(status: GoogleSyncStatus, counts?: Record<string, unknown> | null): string | null {

  const c = counts ?? {};

  if (status.coreComplete && status.enrichmentActive) {

    const processed = Number(c.relationship_groups_processed ?? 0);

    const total = Number(c.relationship_groups_queued ?? 0);

    if (total > 0) return `${processed} of ${total} relationships enriched`;

    const threads = Number(c.threads_used_for_ai ?? 0);

    if (threads > 0) return `${threads} conversations analyzed`;

  }

  if (status.coreActive && (status.stage === "resolving_basic_people" || status.stage === "resolving_basic_companies" || status.stage === "syncing_contacts")) {

    const people = Number(c.people_created ?? 0) + Number(c.people_updated ?? 0);

    const companies = Number(c.companies_created ?? 0) + Number(c.companies_updated ?? 0);

    if (people > 0 || companies > 0) return `${people} people · ${companies} companies discovered`;

  }

  if (status.stage === "discovering_gmail_threads" && c.threads_discovered != null) {

    const total = (Number(c.threads_discovered) + Number(c.ignored_records ?? 0)) || undefined;

    return total ? `${c.threads_discovered} of ${total} threads discovered` : `${c.threads_discovered} threads discovered`;

  }

  if (status.stage === "analyzing_relationships" && c.relationship_groups_processed != null) {

    const total = Number(c.relationship_groups_queued ?? 0);

    return total ? `${c.relationship_groups_processed} of ${total} relationships enriched` : `${c.relationship_groups_processed} relationships enriched`;

  }

  if (status.stage === "resolving_companies" && (c.companies_updated != null || c.people_updated != null)) {

    return `${c.companies_updated ?? 0} companies · ${c.people_updated ?? 0} people`;

  }

  if (status.stage === "enriching_companies" && c.companies_enqueued != null) {

    return `Enriching ${c.companies_enqueued} companies`;

  }

  if (status.processed != null && status.total != null && status.total > 0) {

    return `${status.processed} of ${status.total} processed`;

  }

  if (status.progress_percentage != null) {

    return `${Math.round(status.progress_percentage)}% complete`;

  }

  if (status.processed != null && status.processed > 0) {

    return `${status.processed} items processed`;

  }

  return null;

}



export function formatSyncSummaryText(summary: GoogleSyncSummary, counts?: Record<string, unknown> | null): string {

  const parts: string[] = [];

  const c = counts ?? {};

  const peopleCreated = Number(c.people_created ?? summary.people_created);

  const peopleUpdated = Number(c.people_updated ?? summary.people_updated);

  const companiesCreated = Number(c.companies_created ?? summary.companies_created);

  const companiesUpdated = Number(c.companies_updated ?? summary.companies_updated);

  const candidates = Number(c.candidates_created ?? summary.candidates_created);

  const meetings = Number(c.calendar_meetings_imported ?? c.events_stored ?? c.events_scanned ?? 0);



  if (peopleCreated > 0) parts.push(`${peopleCreated} ${peopleCreated === 1 ? "person" : "people"}`);

  if (peopleUpdated > 0 && peopleCreated === 0) parts.push(`${peopleUpdated} ${peopleUpdated === 1 ? "person" : "people"} updated`);

  if (companiesCreated > 0) parts.push(`${companiesCreated} ${companiesCreated === 1 ? "company" : "companies"}`);

  if (companiesUpdated > 0 && companiesCreated === 0) parts.push(`${companiesUpdated} ${companiesUpdated === 1 ? "company" : "companies"} updated`);

  if (meetings > 0) parts.push(`${meetings} meetings`);

  if (candidates > 0) parts.push(`${candidates} need review`);

  return parts.length > 0 ? parts.join(" · ") : "No CRM changes detected";

}



export function isGoogleSyncActive(status: GoogleSyncStatus): boolean {

  return status.coreActive;

}



export function isGoogleEnrichmentActive(status: GoogleSyncStatus): boolean {

  return status.enrichmentActive;

}



export function canRetryGoogleImport(run: GoogleImportRun | null | undefined): boolean {

  return run?.status === "failed" || run?.status === "timed_out";

}



export function formatInterruptedImportMessage(run: GoogleImportRun | null | undefined): string | null {

  if (!run || (run.status !== "failed" && run.status !== "timed_out")) return null;

  const counts = (run.counts ?? {}) as Record<string, unknown>;

  const discovered = Number(counts.threads_discovered ?? 0);

  const total = discovered + Number(counts.ignored_records ?? 0);

  if (discovered > 0 && total > discovered) {

    return `Initial import interrupted · ${discovered} of ${total} Gmail threads discovered · Retry continues from the saved checkpoint.`;

  }

  if (discovered > 0) {

    return `Initial import interrupted · ${discovered} Gmail threads discovered · Retry continues from the saved checkpoint.`;

  }

  return run.error ?? "Initial import interrupted · Retry continues from the saved checkpoint.";
}
