import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const ACTIVE_GOOGLE_IMPORT_STATUSES = ["queued", "starting", "running", "waiting"] as const;
export const RESUMABLE_GOOGLE_IMPORT_STATUSES = ["failed", "timed_out"] as const;
export const STALE_ACTIVE_HEARTBEAT_MS = 25 * 60 * 1000;
export const DISPATCH_GRACE_MS = 2 * 60 * 1000;

export type GoogleImportRunRow = {
  id: string;
  connection_id: string;
  owner_user_id: string;
  run_type: string;
  status: string;
  progress_stage: string | null;
  sources: string[];
  lookback_months: number;
  settings: Record<string, unknown>;
  counts: Record<string, unknown>;
  trigger_run_id: string | null;
  correlation_id: string | null;
  error_code: string | null;
  failed_at: string | null;
  progress_processed: number | null;
  progress_total: number | null;
  progress_percentage: number | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  warnings: string[];
  created_at: string;
  updated_at: string;
  last_heartbeat_at?: string | null;
  core_sync_status?: string | null;
  enrichment_status?: string | null;
  recovery_status?: string | null;
  next_retry_at?: string | null;
  connection_generation?: number | null;
  operation_identity?: string | null;
  dispatch_status?: string | null;
  sync_mode?: string | null;
  interrupted_at?: string | null;
  import_history?: unknown[];
};

function heartbeatAgeMs(at?: string | null): number | null {
  if (!at) return null;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return null;
  return Date.now() - ts;
}

/** Credible active work — not merely a non-terminal DB status. */
export function isCrediblyActiveImportRun(
  run: Pick<
    GoogleImportRunRow,
    | "status"
    | "last_heartbeat_at"
    | "core_sync_status"
    | "enrichment_status"
    | "recovery_status"
    | "next_retry_at"
    | "trigger_run_id"
    | "dispatch_status"
    | "created_at"
  >,
  options?: { nowMs?: number; staleMs?: number },
): boolean {
  if (!ACTIVE_GOOGLE_IMPORT_STATUSES.includes(run.status as typeof ACTIVE_GOOGLE_IMPORT_STATUSES[number])) {
    return false;
  }

  const now = options?.nowMs ?? Date.now();
  const staleMs = options?.staleMs ?? STALE_ACTIVE_HEARTBEAT_MS;
  const age = heartbeatAgeMs(run.last_heartbeat_at);
  const isStale = age == null || age > staleMs;

  if (run.core_sync_status === "complete" && run.enrichment_status !== "running") {
    return false;
  }

  if (run.next_retry_at) {
    const next = new Date(run.next_retry_at).getTime();
    if (!Number.isNaN(next) && next > now) return true;
  }

  // Recovery/retrying is only active while heartbeat is fresh.
  if (run.recovery_status === "retrying" || run.recovery_status === "recovering") {
    return !isStale;
  }

  // Queued without a confirmed dispatch past grace is not credible active work.
  if (
    (run.status === "queued" || run.status === "starting")
    && !run.trigger_run_id
    && run.dispatch_status !== "dispatched"
  ) {
    const createdAge = heartbeatAgeMs(run.created_at) ?? Number.POSITIVE_INFINITY;
    if (createdAge > DISPATCH_GRACE_MS) return false;
  }

  return !isStale;
}

export async function findActiveGoogleImportRun(
  admin: SupabaseClient,
  connectionId: string,
  options?: { connectionGeneration?: number | null },
): Promise<GoogleImportRunRow | null> {
  let query = admin
    .from("google_import_runs")
    .select("*")
    .eq("connection_id", connectionId)
    .in("status", [...ACTIVE_GOOGLE_IMPORT_STATUSES])
    .order("created_at", { ascending: false })
    .limit(5);

  if (options?.connectionGeneration != null) {
    query = query.eq("connection_generation", options.connectionGeneration);
  }

  const { data } = await query;
  const rows = (data as GoogleImportRunRow[] | null) ?? [];
  for (const row of rows) {
    if (isCrediblyActiveImportRun(row)) return row;
  }
  return null;
}

type CreateImportRunInput = {
  connection_id: string;
  owner_user_id: string;
  run_type: "initial" | "incremental" | "recovery";
  sources: string[];
  lookback_months: number;
  settings: Record<string, unknown>;
  connection_generation?: number;
  operation_identity?: string;
  sync_mode?: string;
};

export type AcquireGoogleSyncRunResult =
  | { already_running: true; import_run: GoogleImportRunRow }
  | { already_running: false; import_run: GoogleImportRunRow };

export async function findResumableGoogleImportRun(
  admin: SupabaseClient,
  connectionId: string,
): Promise<GoogleImportRunRow | null> {
  const { data } = await admin
    .from("google_import_runs")
    .select("*")
    .eq("connection_id", connectionId)
    .in("status", [...RESUMABLE_GOOGLE_IMPORT_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as GoogleImportRunRow | null) ?? null;
}

export async function resumeGoogleImportRun(
  admin: SupabaseClient,
  importRun: GoogleImportRunRow,
  options?: { triggerRunId?: string | null },
): Promise<GoogleImportRunRow> {
  const now = new Date().toISOString();
  const history = Array.isArray(importRun.import_history)
    ? [...importRun.import_history]
    : [];
  history.push({
    at: now,
    event: "resumed",
    detail: "Import resumed from checkpoint.",
  });

  const { data, error } = await admin
    .from("google_import_runs")
    .update({
      status: "queued",
      error: null,
      error_code: null,
      failed_at: null,
      completed_at: null,
      failed_stage: null,
      interrupted_at: null,
      resumed_at: now,
      resumed_from_trigger_run_id: options?.triggerRunId ?? importRun.trigger_run_id,
      last_historical_error_code: importRun.error_code ?? null,
      last_historical_error_message: importRun.error ?? null,
      import_history: history,
      last_heartbeat_at: now,
      dispatch_status: "queued_pending_dispatch",
      recovery_status: "idle",
      action_required: false,
    })
    .eq("id", importRun.id)
    .in("status", [...RESUMABLE_GOOGLE_IMPORT_STATUSES])
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not resume import run.");
  return data as GoogleImportRunRow;
}

export function buildGoogleOperationIdentity(input: {
  connectionId: string;
  googleAccountId: string;
  connectionGeneration: number;
  syncMode: string;
  recoveryGeneration?: number;
}): string {
  const account = input.googleAccountId || "unknown";
  if (input.syncMode === "recovery" || input.recoveryGeneration != null) {
    const suffix = input.recoveryGeneration ?? 1;
    if (input.syncMode === "incremental" || input.syncMode === "incremental_sync") {
      return `google:${input.connectionId}:${account}:generation:${input.connectionGeneration}:incremental:${suffix}`;
    }
    return `google:${input.connectionId}:${account}:generation:${input.connectionGeneration}:recovery:${suffix}`;
  }
  if (input.syncMode === "incremental" || input.syncMode === "incremental_sync" || input.syncMode === "checkpoint_recovery") {
    return `google:${input.connectionId}:${account}:generation:${input.connectionGeneration}:incremental`;
  }
  return `google:${input.connectionId}:${account}:generation:${input.connectionGeneration}:initial`;
}

export async function interruptActiveGoogleImportRuns(
  admin: SupabaseClient,
  connectionId: string,
  options: {
    reasonCode?: string;
    reasonMessage?: string;
    excludeRunId?: string | null;
  } = {},
): Promise<{ interrupted_ids: string[] }> {
  const reasonCode = options.reasonCode ?? "GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT";
  const reasonMessage = options.reasonMessage
    ?? "Previous Google sync was interrupted because the connection was disconnected or reconnected.";
  const now = new Date().toISOString();

  let query = admin
    .from("google_import_runs")
    .select("id, import_history, status")
    .eq("connection_id", connectionId)
    .in("status", [...ACTIVE_GOOGLE_IMPORT_STATUSES]);

  if (options.excludeRunId) {
    query = query.neq("id", options.excludeRunId);
  }

  const { data: active } = await query;
  const interruptedIds: string[] = [];

  for (const row of active ?? []) {
    const history = Array.isArray((row as { import_history?: unknown[] }).import_history)
      ? [...((row as { import_history?: unknown[] }).import_history ?? [])]
      : [];
    history.push({
      at: now,
      event: "interrupted",
      detail: reasonMessage,
    });

    const { data } = await admin
      .from("google_import_runs")
      .update({
        status: "cancelled",
        progress_stage: "failed",
        error_code: reasonCode,
        error: reasonMessage,
        interrupted_at: now,
        cancelled_at: now,
        completed_at: now,
        last_heartbeat_at: now,
        recovery_status: "idle",
        action_required: false,
        next_retry_at: null,
        import_history: history,
        updated_at: now,
      })
      .eq("id", row.id)
      .in("status", [...ACTIVE_GOOGLE_IMPORT_STATUSES])
      .select("id")
      .maybeSingle();

    if (data?.id) interruptedIds.push(data.id);
  }

  await admin
    .from("google_sync_leases")
    .update({ status: "expired", updated_at: now })
    .eq("connection_id", connectionId)
    .eq("status", "active");

  return { interrupted_ids: interruptedIds };
}

export async function bumpConnectionGeneration(
  admin: SupabaseClient,
  connectionId: string,
): Promise<number> {
  const { data: current } = await admin
    .from("user_google_connections")
    .select("connection_generation")
    .eq("id", connectionId)
    .maybeSingle();

  const next = Number(current?.connection_generation ?? 1) + 1;
  const { error } = await admin
    .from("user_google_connections")
    .update({ connection_generation: next, updated_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
  return next;
}

export async function acquireGoogleSyncRun(
  admin: SupabaseClient,
  input: CreateImportRunInput,
  options?: { resume?: boolean },
): Promise<AcquireGoogleSyncRunResult> {
  const existing = await findActiveGoogleImportRun(admin, input.connection_id, {
    connectionGeneration: input.connection_generation,
  });
  if (existing) {
    return { already_running: true, import_run: existing };
  }

  // Clear non-credible zombie rows that still occupy the unique active index.
  await interruptActiveGoogleImportRuns(admin, input.connection_id, {
    reasonCode: "GOOGLE_SYNC_STALE_LEASE",
    reasonMessage: "Stale Google sync without a live worker was cleared before starting a new operation.",
  });

  if (options?.resume) {
    const resumable = await findResumableGoogleImportRun(admin, input.connection_id);
    if (resumable) {
      const resumed = await resumeGoogleImportRun(admin, resumable);
      return { already_running: false, import_run: resumed };
    }
  }

  const correlationId = crypto.randomUUID();
  const syncMode = input.sync_mode ?? input.run_type;
  const { data: importRun, error } = await admin
    .from("google_import_runs")
    .insert({
      connection_id: input.connection_id,
      owner_user_id: input.owner_user_id,
      run_type: input.run_type,
      status: "queued",
      progress_stage: "queued",
      sources: input.sources,
      lookback_months: input.lookback_months,
      settings: input.settings,
      correlation_id: correlationId,
      sync_mode: syncMode,
      processor_version: 2,
      workflow_version: 2,
      core_sync_status: "pending",
      enrichment_status: "pending",
      connection_generation: input.connection_generation ?? null,
      operation_identity: input.operation_identity ?? null,
      dispatch_status: "queued_pending_dispatch",
      last_heartbeat_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const active = await findActiveGoogleImportRun(admin, input.connection_id, {
        connectionGeneration: input.connection_generation,
      });
      if (active) return { already_running: true, import_run: active };
      // Unique operation_identity collision: return the existing row.
      if (input.operation_identity) {
        const { data: byIdentity } = await admin
          .from("google_import_runs")
          .select("*")
          .eq("operation_identity", input.operation_identity)
          .maybeSingle();
        if (byIdentity) {
          return { already_running: true, import_run: byIdentity as GoogleImportRunRow };
        }
      }
    }
    throw new Error(error.message);
  }

  return { already_running: false, import_run: importRun as GoogleImportRunRow };
}

export function canonicalStageFromRun(run: Pick<GoogleImportRunRow, "status" | "progress_stage">): string {
  if (run.status === "timed_out") return "failed";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "failed";
  if (run.status === "completed_with_warnings") return "completed_with_warnings";
  if (run.status === "completed") return "completed";
  if (run.status === "queued" && (!run.progress_stage || run.progress_stage === "queued")) return "queued";
  if (run.status === "starting" || run.progress_stage === "starting") return "queued";
  const stage = run.progress_stage ?? run.status;
  const allowed = new Set([
    "queued",
    "validating_connection",
    "syncing_contacts",
    "syncing_calendar",
    "syncing_gmail",
    "discovering_gmail_threads",
    "processing_gmail_threads",
    "resolving_basic_people",
    "resolving_basic_companies",
    "completing_core_sync",
    "core_sync_complete",
    "filtering_relationship_threads",
    "analyzing_relationships",
    "enrichment_complete",
    "resolving_entities",
    "resolving_people",
    "resolving_companies",
    "processing_relationships",
    "creating_candidates",
    "enriching_companies",
    "finalizing",
    "completed",
    "completed_with_warnings",
    "failed",
  ]);
  if (allowed.has(stage)) return stage;
  if (run.status === "running" || run.status === "waiting") return "finalizing";
  return "queued";
}
