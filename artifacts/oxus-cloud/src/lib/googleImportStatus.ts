import type { GoogleImportRun } from "@/lib/types";
import type { GoogleSyncStage } from "@/lib/googleSync";

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting"]);
const TERMINAL_STATUSES = new Set(["completed", "completed_with_warnings", "failed", "cancelled", "timed_out"]);
const RECOVERABLE_ERROR_CODES = new Set(["MAX_DURATION_EXCEEDED", "STALE_RUN_RECONCILED", "IDLE_TIMEOUT"]);
const CORE_PROGRESS_STAGES = new Set([
  "queued", "starting", "validating_connection", "syncing_contacts", "syncing_calendar", "syncing_gmail",
  "discovering_gmail_threads", "processing_gmail_threads", "resolving_basic_people", "resolving_basic_companies",
  "resolving_entities", "resolving_people", "resolving_companies", "creating_candidates", "enriching_companies",
  "finalizing", "completing_core_sync",
]);
const ACTIVE_WORK_HEARTBEAT_MS = 20 * 60 * 1000;
const STALE_ACTIVE_HEARTBEAT_MS = 25 * 60 * 1000;

export type GoogleImportSourceRunSnapshot = {
  source: string;
  status: string;
  current_stage?: string | null;
  last_heartbeat_at?: string | null;
};

export type GoogleImportHistoryEvent = {
  at: string;
  event: string;
  detail?: string;
};

export type GoogleImportProgressCounts = {
  gmail_threads_discovered: number;
  gmail_threads_selected: number;
  gmail_threads_processed: number;
  source_people_normalized: number;
  source_companies_normalized: number;
  crm_people_created: number;
  crm_people_updated: number;
  crm_companies_created: number;
  crm_companies_updated: number;
  internal_candidates_created: number;
  review_candidates_pending: number;
  warnings: number;
};

export type GoogleImportHistoricalInterruption = {
  code: string;
  message: string;
  occurred_at: string;
  resumed_at?: string;
};

export type GoogleCanonicalImportPhase = "idle" | "core_sync" | "enrichment" | "complete" | "paused" | "failed";

export type GoogleCanonicalImportStatus = {
  import_run_id: string | null;
  status: "idle" | "queued" | "running" | "completed" | "completed_with_warnings" | "paused" | "failed" | "cancelled";
  phase: GoogleCanonicalImportPhase;
  stage: GoogleSyncStage;
  active: boolean;
  recovered: boolean;
  action_required: boolean;
  show_retry: boolean;
  banner_severity: "none" | "info" | "warning" | "error";
  title: string;
  subtitle: string | null;
  historical_interruption: GoogleImportHistoricalInterruption | null;
  progress: GoogleImportProgressCounts;
  history: GoogleImportHistoryEvent[];
  started_at?: string;
  completed_at?: string;
  trigger_run_id?: string;
  current_error?: { code: string; message: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseHistory(value: unknown): GoogleImportHistoryEvent[] {
  if (!Array.isArray(value)) return [];
  const events: GoogleImportHistoryEvent[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (typeof row.at !== "string" || typeof row.event !== "string") continue;
    events.push({
      at: row.at,
      event: row.event,
      detail: typeof row.detail === "string" ? row.detail : undefined,
    });
  }
  return events;
}

function heartbeatAgeMs(at?: string | null): number | null {
  if (!at) return null;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return null;
  return Date.now() - ts;
}

function hasRecentHeartbeat(run: Pick<GoogleImportRun, "last_heartbeat_at">, maxMs = ACTIVE_WORK_HEARTBEAT_MS): boolean {
  const age = heartbeatAgeMs(run.last_heartbeat_at);
  return age != null && age <= maxMs;
}

function isLiveActiveStatus(run: GoogleImportRun): boolean {
  if (!ACTIVE_STATUSES.has(run.status)) return false;
  if (run.recovery_status === "recovering" || run.recovery_status === "retrying") {
    return hasRecentHeartbeat(run, STALE_ACTIVE_HEARTBEAT_MS);
  }
  if (run.core_sync_status === "complete" && run.enrichment_status !== "running") return false;
  if (
    (run.status === "queued" || run.status === "starting")
    && !run.trigger_run_id
    && run.dispatch_status !== "dispatched"
  ) {
    const createdAge = heartbeatAgeMs(run.created_at);
    if (createdAge == null || createdAge > 2 * 60 * 1000) return false;
  }
  return hasRecentHeartbeat(run, ACTIVE_WORK_HEARTBEAT_MS);
}

function isProgressingStage(stage?: string | null): boolean {
  if (!stage) return false;
  if (stage === "failed" || stage === "completed" || stage === "completed_with_warnings") return false;
  return true;
}

function hasActiveSourceWork(sourceRuns: GoogleImportSourceRunSnapshot[] | undefined): boolean {
  return (sourceRuns ?? []).some((row) => {
    if (!["queued", "running", "waiting", "starting"].includes(row.status)) return false;
    const age = heartbeatAgeMs(row.last_heartbeat_at);
    return age == null || age <= ACTIVE_WORK_HEARTBEAT_MS;
  });
}

function hasRecoverableActiveWork(
  run: GoogleImportRun,
  sourceRuns?: GoogleImportSourceRunSnapshot[],
): boolean {
  // Recovery/retry only counts while heartbeat is fresh or a future retry is scheduled.
  if (run.recovery_status === "retrying" || run.recovery_status === "recovering") {
    if (run.next_retry_at) {
      const next = new Date(run.next_retry_at).getTime();
      if (!Number.isNaN(next) && next > Date.now()) return true;
    }
    if (!hasRecentHeartbeat(run, STALE_ACTIVE_HEARTBEAT_MS)) return false;
  }
  if (run.next_retry_at) {
    const next = new Date(run.next_retry_at).getTime();
    if (!Number.isNaN(next) && next > Date.now()) return true;
  }
  if (run.finalization_heartbeat_at) {
    const age = heartbeatAgeMs(run.finalization_heartbeat_at);
    if (age != null && age <= ACTIVE_WORK_HEARTBEAT_MS) return true;
  }
  if (isLiveActiveStatus(run)) return true;
  if (hasActiveSourceWork(sourceRuns)) return true;

  // Without a confirmed Trigger.dev dispatch, do not invent active work from stage labels.
  if (!run.trigger_run_id && run.dispatch_status !== "dispatched") {
    return false;
  }

  const heartbeatRecent = hasRecentHeartbeat(run, ACTIVE_WORK_HEARTBEAT_MS);
  const stage = run.progress_stage ?? "";
  if (!heartbeatRecent || !isProgressingStage(stage)) return false;

  if (CORE_PROGRESS_STAGES.has(stage)) return true;
  if (run.core_sync_status === "complete" && run.enrichment_status === "running") return true;
  if (stage === "core_sync_complete" || stage === "analyzing_relationships" || stage === "filtering_relationship_threads") {
    return true;
  }

  const counts = asRecord(run.counts);
  return Number(counts.people_updated ?? 0) > 0
    || Number(counts.people_created ?? 0) > 0
    || Number(counts.candidates_created ?? 0) > 0
    || Number(counts.email_threads_processed ?? 0) > 0;
}

function buildProgressCounts(
  run: GoogleImportRun | null | undefined,
  reviewCandidatesPending = 0,
): GoogleImportProgressCounts {
  const counts = asRecord(run?.counts);
  const discovered = Number(counts.threads_discovered ?? 0);
  const ignored = Number(counts.ignored_records ?? 0);
  const selected = Number(counts.threads_selected ?? counts.threads_used_for_ai ?? discovered);
  return {
    gmail_threads_discovered: discovered,
    gmail_threads_selected: selected,
    gmail_threads_processed: Number(counts.email_threads_processed ?? counts.threads_processed ?? 0),
    source_people_normalized: Number(counts.people_created ?? 0) + Number(counts.people_updated ?? 0),
    source_companies_normalized: Number(counts.companies_created ?? 0) + Number(counts.companies_updated ?? 0),
    crm_people_created: Number(counts.people_created ?? 0),
    crm_people_updated: Number(counts.people_updated ?? 0),
    crm_companies_created: Number(counts.companies_created ?? 0),
    crm_companies_updated: Number(counts.companies_updated ?? 0),
    internal_candidates_created: Number(counts.candidates_created ?? 0),
    review_candidates_pending: reviewCandidatesPending,
    warnings: Number(counts.warnings ?? run?.warnings?.length ?? 0),
  };
}

function historicalInterruption(run: GoogleImportRun): GoogleImportHistoricalInterruption | null {
  const code = run.last_historical_error_code ?? null;
  const message = run.last_historical_error_message ?? null;
  if (!code && !message) return null;
  return {
    code: code ?? "INTERRUPTED",
    message: message ?? "Import previously interrupted and later resumed.",
    occurred_at: run.failed_at ?? run.updated_at ?? run.created_at,
    resumed_at: run.resumed_at ?? run.recovered_at ?? undefined,
  };
}

function stageLabel(stage: GoogleSyncStage, run?: GoogleImportRun | null): string {
  const isIncremental = run?.run_type === "incremental" || run?.sync_mode === "incremental" || run?.sync_mode === "incremental_sync";
  const labels: Partial<Record<GoogleSyncStage, string>> = {
    resolving_basic_people: isIncremental ? "Updating Google data" : "Building your CRM",
    resolving_basic_companies: isIncremental ? "Updating Google data" : "Building your CRM",
    resolving_entities: isIncremental ? "Updating Google data" : "Building your CRM",
    resolving_people: isIncremental ? "Updating Google data" : "Building your CRM",
    resolving_companies: isIncremental ? "Updating Google data" : "Building your CRM",
    syncing_contacts: "Syncing recent changes",
    syncing_calendar: "Syncing recent changes",
    syncing_gmail: "Syncing recent changes",
    completing_core_sync: "Finishing CRM sync",
    core_sync_complete: "Google data synced",
    analyzing_relationships: "Google data synced",
    completed: "Google Workspace is up to date",
    completed_with_warnings: "Google sync completed with warnings",
    failed: "Google sync failed",
    queued: isIncremental ? "Preparing Google sync" : "Preparing Google import",
  };
  if (labels[stage]) return labels[stage]!;
  return isIncremental ? "Updating Google data" : "Building your CRM";
}

function stageSubtitle(stage: GoogleSyncStage, progress: GoogleImportProgressCounts): string | null {
  if (stage === "completing_core_sync") {
    return "People and companies have been processed. Finalizing Google sync state...";
  }
  if (stage === "resolving_people" || stage === "resolving_basic_people" || stage === "resolving_entities") {
    const parts: string[] = ["Resolving people and companies from Google activity"];
    if (progress.crm_people_updated > 0) parts.push(`${progress.crm_people_updated} people updated`);
    if (progress.review_candidates_pending > 0) {
      parts.push(`${progress.review_candidates_pending} records prepared for review`);
    } else if (progress.internal_candidates_created > 0) {
      parts.push(`${progress.internal_candidates_created} records processed`);
    }
    return parts.join(" · ");
  }
  if (stage === "resolving_companies" || stage === "resolving_basic_companies") {
    return `Resolving companies from Google activity · ${progress.crm_companies_updated} companies updated`;
  }
  if (stage === "discovering_gmail_threads" && progress.gmail_threads_discovered > 0) {
    const total = progress.gmail_threads_discovered + Number(progress.gmail_threads_selected > progress.gmail_threads_discovered ? 0 : 0);
    return total > progress.gmail_threads_discovered
      ? `${progress.gmail_threads_discovered} of ${total} Gmail threads discovered`
      : `${progress.gmail_threads_discovered} Gmail threads discovered`;
  }
  if (stage === "analyzing_relationships" || stage === "filtering_relationship_threads") {
    return "Relationship enrichment continues in the background";
  }
  if (stage === "completed_with_warnings" && progress.warnings > 0) {
    return `Google sync completed with ${progress.warnings} warnings`;
  }
  return null;
}

function mapStage(run: GoogleImportRun, activeWork: boolean): GoogleSyncStage {
  if (!activeWork) {
    if (run.core_sync_status === "complete" && run.enrichment_status !== "running") return "completed";
    if (run.status === "timed_out" || run.status === "failed" || run.progress_stage === "failed") return "failed";
    if (run.status === "completed_with_warnings") return "completed_with_warnings";
    if (run.status === "completed") return "completed";
    if (run.status === "cancelled") return "failed";
  }

  const stage = run.progress_stage ?? run.status;
  const known = new Set<GoogleSyncStage>([
    "queued", "validating_connection", "syncing_contacts", "syncing_calendar", "syncing_gmail",
    "discovering_gmail_threads", "processing_gmail_threads", "resolving_basic_people", "resolving_basic_companies",
    "completing_core_sync", "core_sync_complete", "filtering_relationship_threads", "analyzing_relationships", "enrichment_complete",
    "resolving_entities", "resolving_people", "resolving_companies", "processing_relationships",
    "creating_candidates", "enriching_companies", "finalizing", "completed", "completed_with_warnings",
  ]);
  if (known.has(stage as GoogleSyncStage)) return stage as GoogleSyncStage;
  if (run.core_sync_status === "complete" && run.enrichment_status === "running") return "analyzing_relationships";
  if (ACTIVE_STATUSES.has(run.status) || activeWork) return "queued";
  return "idle";
}

function derivePhase(run: GoogleImportRun, stage: GoogleSyncStage, activeWork: boolean): GoogleCanonicalImportPhase {
  if (!run || run.status === "cancelled") return "failed";
  if (!activeWork && (run.status === "failed" || run.status === "timed_out")) return "paused";
  if (!activeWork && TERMINAL_STATUSES.has(run.status) && run.status !== "timed_out") {
    return run.status === "completed" || run.status === "completed_with_warnings" ? "complete" : "failed";
  }
  if (stage === "completed" || stage === "completed_with_warnings") return "complete";
  if (run.core_sync_status === "complete" && run.enrichment_status !== "running" && !activeWork) {
    return "complete";
  }
  if ((run.core_sync_status === "complete" || stage === "core_sync_complete" || stage === "analyzing_relationships")
    && run.enrichment_status === "running" && activeWork) {
    return "enrichment";
  }
  if (activeWork || ACTIVE_STATUSES.has(run.status)) return "core_sync";
  if (run.status === "timed_out" || run.status === "failed") return "paused";
  return "idle";
}

function isRecoverableInterruption(run: GoogleImportRun): boolean {
  if (run.recovery_status === "retrying" || run.recovery_status === "recovering") return false;
  if (run.action_required === false && (run.status === "timed_out" || run.status === "failed")) return false;
  if (run.status !== "timed_out" && run.status !== "failed") return false;
  const code = run.error_code ?? "";
  return RECOVERABLE_ERROR_CODES.has(code) || run.recovery_status === "needs_attention";
}

function sanitizeCurrentErrorMessage(raw: string | null | undefined, code?: string | null): string {
  if (code === "MAX_DURATION_EXCEEDED" || code === "STALE_RUN_RECONCILED" || code === "IDLE_TIMEOUT") {
    return "Import paused. Retry will continue from the saved checkpoint.";
  }
  if (!raw) return "Synchronization failed. Try again or reconnect Google.";
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

export function resolveCanonicalGoogleImportStatus(input: {
  run: GoogleImportRun | null | undefined;
  sourceRuns?: GoogleImportSourceRunSnapshot[];
  reviewCandidatesPending?: number;
  connectionError?: string | null;
}): GoogleCanonicalImportStatus {
  const { run, sourceRuns, reviewCandidatesPending = 0, connectionError } = input;
  const progress = buildProgressCounts(run, reviewCandidatesPending);
  const history = parseHistory(run?.import_history);

  if (!run) {
    if (connectionError) {
      return {
        import_run_id: null,
        status: "failed",
        phase: "failed",
        stage: "failed",
        active: false,
        recovered: false,
        action_required: true,
        show_retry: false,
        banner_severity: "error",
        title: "Google sync failed",
        subtitle: sanitizeCurrentErrorMessage(connectionError, "CONNECTION_ERROR"),
        historical_interruption: null,
        progress,
        history,
        current_error: { code: "CONNECTION_ERROR", message: sanitizeCurrentErrorMessage(connectionError) },
      };
    }
    return {
      import_run_id: null,
      status: "idle",
      phase: "idle",
      stage: "idle",
      active: false,
      recovered: false,
      action_required: false,
      show_retry: false,
      banner_severity: "none",
      title: "Google Workspace",
      subtitle: null,
      historical_interruption: null,
      progress,
      history,
    };
  }

  const activeWork = hasRecoverableActiveWork(run, sourceRuns);
  const recovered = Boolean(run.recovered_at || run.resumed_at || run.last_historical_error_code);
  const stage = mapStage(run, activeWork);
  const phase = derivePhase(run, stage, activeWork);
  const historical = historicalInterruption(run);

  if (activeWork) {
    const title = run.recovery_status === "recovering"
      ? "Resuming CRM sync"
      : run.progress_stage === "completing_core_sync"
        ? "Finishing CRM sync"
        : stageLabel(stage, run);
    const subtitle = run.recovery_status === "recovering"
      ? "Automatic recovery is continuing from the saved checkpoint."
      : stageSubtitle(stage, progress);
    return {
      import_run_id: run.id,
      status: run.status === "queued" || run.status === "starting" || run.status === "waiting" ? "queued" : "running",
      phase,
      stage,
      active: true,
      recovered,
      action_required: false,
      show_retry: false,
      banner_severity: "info",
      title,
      subtitle,
      historical_interruption: historical,
      progress,
      history,
      started_at: run.started_at ?? undefined,
      trigger_run_id: run.trigger_run_id ?? undefined,
    };
  }

  if (phase === "enrichment" || (run.core_sync_status === "complete" && run.enrichment_status === "running" && isLiveActiveStatus(run))) {
    return {
      import_run_id: run.id,
      status: "running",
      phase: "enrichment",
      stage: "analyzing_relationships",
      active: true,
      recovered,
      action_required: false,
      show_retry: false,
      banner_severity: "info",
      title: "Google data synced",
      subtitle: "Relationship enrichment continues in the background",
      historical_interruption: historical,
      progress,
      history,
      started_at: run.started_at ?? undefined,
      trigger_run_id: run.trigger_run_id ?? undefined,
    };
  }

  if (run.status === "completed_with_warnings") {
    return {
      import_run_id: run.id,
      status: "completed_with_warnings",
      phase: "complete",
      stage: "completed_with_warnings",
      active: false,
      recovered,
      action_required: false,
      show_retry: false,
      banner_severity: progress.warnings > 0 ? "warning" : "none",
      title: "Google sync completed with warnings",
      subtitle: progress.warnings > 0 ? `${progress.warnings} warnings recorded during sync` : null,
      historical_interruption: historical,
      progress,
      history,
      completed_at: run.completed_at ?? undefined,
      trigger_run_id: run.trigger_run_id ?? undefined,
    };
  }

  if (run.status === "completed") {
    return {
      import_run_id: run.id,
      status: "completed",
      phase: "complete",
      stage: "completed",
      active: false,
      recovered,
      action_required: false,
      show_retry: false,
      banner_severity: "none",
      title: "Google Workspace is up to date",
      subtitle: null,
      historical_interruption: recovered && historical ? historical : null,
      progress,
      history,
      completed_at: run.completed_at ?? undefined,
      trigger_run_id: run.trigger_run_id ?? undefined,
    };
  }

  if (run.core_sync_status === "complete" && !isLiveActiveStatus(run) && run.enrichment_status !== "running") {
    return {
      import_run_id: run.id,
      status: "completed",
      phase: "complete",
      stage: "completed",
      active: false,
      recovered,
      action_required: false,
      show_retry: false,
      banner_severity: "none",
      title: "Google Workspace is up to date",
      subtitle: null,
      historical_interruption: recovered && historical ? historical : null,
      progress,
      history,
      completed_at: run.completed_at ?? undefined,
      trigger_run_id: run.trigger_run_id ?? undefined,
    };
  }

  if (isRecoverableInterruption(run) && run.action_required !== false) {
    const needsAttention = run.recovery_status === "needs_attention" || run.error_code === "RETRY_BUDGET_EXHAUSTED";
    return {
      import_run_id: run.id,
      status: "paused",
      phase: "paused",
      stage: "failed",
      active: false,
      recovered,
      action_required: true,
      show_retry: true,
      banner_severity: "warning",
      title: needsAttention ? "Import needs attention" : "Import paused",
      subtitle: needsAttention
        ? "Automatic recovery could not finish. Retry or view details to continue."
        : "Retry will continue from the saved checkpoint.",
      historical_interruption: historical ?? {
        code: run.error_code ?? "INTERRUPTED",
        message: run.error ?? "Import interrupted.",
        occurred_at: run.failed_at ?? run.updated_at,
        resumed_at: run.resumed_at ?? undefined,
      },
      progress,
      history,
      started_at: run.started_at ?? undefined,
      completed_at: run.failed_at ?? undefined,
      trigger_run_id: run.trigger_run_id ?? undefined,
    };
  }

  const code = run.error_code ?? "SYNC_FAILED";
  return {
    import_run_id: run.id,
    status: "failed",
    phase: "failed",
    stage: "failed",
    active: false,
    recovered,
    action_required: true,
    show_retry: run.status !== "cancelled",
    banner_severity: "error",
    title: "Google sync failed",
    subtitle: sanitizeCurrentErrorMessage(run.error, code),
    historical_interruption: historical,
    progress,
    history,
    started_at: run.started_at ?? undefined,
    completed_at: run.failed_at ?? run.completed_at ?? undefined,
    trigger_run_id: run.trigger_run_id ?? undefined,
    current_error: { code, message: sanitizeCurrentErrorMessage(run.error, code) },
  };
}

export function buildImportHistoryEvent(event: string, detail?: string): GoogleImportHistoryEvent {
  return { at: new Date().toISOString(), event, detail };
}

export function shouldReactivateInterruptedImportRun(run: Pick<
  GoogleImportRun,
  "status" | "error_code" | "error" | "progress_stage" | "last_heartbeat_at"
> | null | undefined): boolean {
  if (!run) return false;
  if (!["timed_out", "failed"].includes(run.status)) return false;
  return hasRecentHeartbeat(run, ACTIVE_WORK_HEARTBEAT_MS) && isProgressingStage(run.progress_stage);
}

export function reactivateImportRunPatch(run: Pick<
  GoogleImportRun,
  "error_code" | "error" | "trigger_run_id" | "import_history"
>): Record<string, unknown> {
  const now = new Date().toISOString();
  const history = parseHistory(run.import_history);
  history.push(buildImportHistoryEvent(
    "recovered",
    run.error_code
      ? `Import resumed after ${run.error_code.replaceAll("_", " ").toLowerCase()}.`
      : "Import resumed from checkpoint.",
  ));
  return {
    status: "running",
    error_code: null,
    error: null,
    failed_at: null,
    completed_at: null,
    failed_stage: null,
    recovered_at: now,
    last_historical_error_code: run.error_code ?? null,
    last_historical_error_message: run.error ?? null,
    import_history: history,
    last_heartbeat_at: now,
    updated_at: now,
  };
}

export function googleSyncStatusFromCanonical(canonical: GoogleCanonicalImportStatus): import("@/lib/googleSync").GoogleSyncStatus {
  const summary = {
    companies_created: canonical.progress.crm_companies_created,
    companies_updated: canonical.progress.crm_companies_updated,
    people_created: canonical.progress.crm_people_created,
    people_updated: canonical.progress.crm_people_updated,
    candidates_created: canonical.progress.review_candidates_pending,
    warnings: canonical.progress.warnings,
  };

  return {
    active: canonical.active,
    coreActive: canonical.active && canonical.phase === "core_sync",
    enrichmentActive: canonical.active && canonical.phase === "enrichment",
    coreComplete: canonical.phase === "enrichment" || canonical.phase === "complete",
    stage: canonical.stage,
    import_run_id: canonical.import_run_id ?? undefined,
    trigger_run_id: canonical.trigger_run_id,
    started_at: canonical.started_at,
    completed_at: canonical.completed_at,
    summary: canonical.active ? undefined : summary,
    error: canonical.current_error,
  };
}
