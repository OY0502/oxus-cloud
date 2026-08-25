import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const ACTIVE_IMPORT_STATUSES = ["queued", "starting", "running", "waiting"] as const;
const ACTIVE_SOURCE_STATUSES = ["queued", "running", "waiting", "starting"] as const;
const PROGRESSING_STAGES = new Set([
  "validating_connection", "syncing_contacts", "syncing_calendar", "syncing_gmail",
  "discovering_gmail_threads", "processing_gmail_threads", "resolving_basic_people",
  "resolving_basic_companies", "resolving_entities", "resolving_people", "resolving_companies",
  "filtering_relationship_threads", "analyzing_relationships", "creating_candidates",
  "enriching_companies", "finalizing", "completing_core_sync", "core_sync_complete",
]);

type StaleRunRow = {
  id: string;
  status: string;
  progress_stage: string | null;
  counts: Record<string, unknown> | null;
  last_heartbeat_at: string | null;
};

function checkpointSummary(run: StaleRunRow): string {
  const counts = run.counts ?? {};
  const discovered = Number(counts.threads_discovered ?? 0);
  const processed = Number(counts.email_threads_processed ?? 0);
  if (discovered > 0) {
    return `Initial import interrupted after ${discovered} Gmail threads were discovered. Retry will continue from the saved checkpoint.`;
  }
  if (processed > 0) {
    return `Initial import interrupted after ${processed} Gmail threads were processed. Retry will continue from the saved checkpoint.`;
  }
  return "Initial import interrupted. Retry will continue from the saved checkpoint.";
}

function heartbeatAgeMs(at?: string | null): number | null {
  if (!at) return null;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return null;
  return Date.now() - ts;
}

async function hasActiveSourceRuns(admin: SupabaseClient, importRunId: string): Promise<boolean> {
  const { data } = await admin
    .from("google_import_source_runs")
    .select("status, last_heartbeat_at")
    .eq("import_run_id", importRunId)
    .in("status", [...ACTIVE_SOURCE_STATUSES]);
  return (data ?? []).some((row) => {
    const age = heartbeatAgeMs(row.last_heartbeat_at as string | null);
    return age == null || age <= 20 * 60 * 1000;
  });
}

function shouldSkipStaleReconcile(run: StaleRunRow, staleMs: number): boolean {
  const age = heartbeatAgeMs(run.last_heartbeat_at);
  if (age != null && age <= staleMs) return true;
  if (run.progress_stage && PROGRESSING_STAGES.has(run.progress_stage)) {
    const counts = run.counts ?? {};
    if (
      Number(counts.people_updated ?? 0) > 0
      || Number(counts.people_created ?? 0) > 0
      || Number(counts.candidates_created ?? 0) > 0
    ) {
      return true;
    }
  }
  return false;
}

async function hasRecoveryProtection(
  admin: SupabaseClient,
  importRunId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("google_import_runs")
    .select("recovery_status, next_retry_at, finalization_heartbeat_at")
    .eq("id", importRunId)
    .maybeSingle();
  if (!data) return false;
  if (data.recovery_status === "retrying" || data.recovery_status === "recovering") return true;
  if (data.next_retry_at) {
    const next = new Date(data.next_retry_at as string).getTime();
    if (!Number.isNaN(next) && next > Date.now()) return true;
  }
  if (data.finalization_heartbeat_at) {
    const age = heartbeatAgeMs(data.finalization_heartbeat_at as string);
    if (age != null && age <= 15 * 60 * 1000) return true;
  }
  return false;
}

export async function reconcileStaleGoogleImportRuns(
  admin: SupabaseClient,
  options?: { staleMs?: number },
) {
  const staleMs = options?.staleMs ?? 12 * 60 * 1000;
  const cutoff = new Date(Date.now() - staleMs).toISOString();

  const { data: staleRuns } = await admin
    .from("google_import_runs")
    .select("id, status, progress_stage, counts, last_heartbeat_at")
    .in("status", [...ACTIVE_IMPORT_STATUSES])
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${cutoff}`)
    .limit(50);

  let reconciledCount = 0;
  for (const run of (staleRuns ?? []) as StaleRunRow[]) {
    if (shouldSkipStaleReconcile(run, staleMs)) continue;
    if (await hasRecoveryProtection(admin, run.id)) continue;
    if (await hasActiveSourceRuns(admin, run.id)) continue;

    const now = new Date().toISOString();
    await admin
      .from("google_import_runs")
      .update({
        status: "timed_out",
        progress_stage: "failed",
        error_code: "STALE_RUN_RECONCILED",
        error: checkpointSummary(run),
        last_historical_error_code: "STALE_RUN_RECONCILED",
        last_historical_error_message: checkpointSummary(run),
        failed_at: now,
        completed_at: now,
        last_heartbeat_at: now,
        import_history: [{
          at: now,
          event: "interrupted",
          detail: "Import marked stale after heartbeat timeout.",
        }],
      })
      .eq("id", run.id)
      .in("status", [...ACTIVE_IMPORT_STATUSES]);
    reconciledCount++;
  }

  return { reconciled_count: reconciledCount };
}

export async function cancelGoogleImportRun(admin: SupabaseClient, importRunId: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("google_import_runs")
    .update({
      status: "cancelled",
      progress_stage: "failed",
      error_code: "CANCELLED_BY_USER",
      error: "Import cancelled. Completed CRM records were preserved.",
      cancelled_at: now,
      completed_at: now,
      last_heartbeat_at: now,
    })
    .eq("id", importRunId)
    .in("status", [...ACTIVE_IMPORT_STATUSES])
    .select("id, status")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
