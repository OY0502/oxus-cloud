import { randomUUID } from "node:crypto";
import { getServiceClient, invokeAgentWorker } from "../server/supabase";
import { classifyGoogleSyncError } from "../lib/googleImportRecovery";
import type { GoogleSyncBatchAction } from "./googleSyncBatchTypes.ts";

type GoogleWorkerPayload = {
  import_run_id: string;
  connection_id: string;
  user_id: string;
  correlation_id?: string;
  action?: GoogleSyncBatchAction;
};

type WorkerErrorBody = {
  error?: string;
  code?: string;
  correlation_id?: string;
};

type BatchWorkerResult = {
  success?: boolean;
  done?: boolean;
  action?: string;
  stage?: string;
  counts?: Record<string, number>;
  processed_in_batch?: number;
};

function parseWorkerError(status: number, text: string): { message: string; code: string } {
  try {
    const body = JSON.parse(text) as WorkerErrorBody;
    return {
      message: body.error ?? text.slice(0, 800),
      code: body.code ?? (status === 401 ? "INTERNAL_AUTH_INVALID" : "WORKER_INVOKE_FAILED"),
    };
  } catch {
    return {
      message: text.slice(0, 800) || `Worker failed (${status})`,
      code: status === 401 ? "INTERNAL_AUTH_INVALID" : "WORKER_INVOKE_FAILED",
    };
  }
}

async function markGoogleImportRunFailed(
  importRunId: string,
  error: { message: string; code: string },
  triggerRunId?: string,
  failedStage?: string,
  status: "failed" | "timed_out" = "failed",
) {
  const admin = getServiceClient();
  const now = new Date().toISOString();
  const classification = classifyGoogleSyncError(error.code, error.message);

  if (classification === "recoverable") {
    const { data: current } = await admin
      .from("google_import_runs")
      .select("retry_count, import_history, progress_stage")
      .eq("id", importRunId)
      .maybeSingle();
    const retryCount = Number(current?.retry_count ?? 0) + 1;
    const history = Array.isArray(current?.import_history) ? [...current.import_history] : [];
    history.push({
      at: now,
      event: "retry_scheduled",
      detail: `${failedStage ?? "worker"}: ${error.code}`,
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

  await admin
    .from("google_import_runs")
    .update({
      status,
      progress_stage: "failed",
      failed_stage: failedStage ?? null,
      error: error.message.slice(0, 500),
      error_code: error.code,
      action_required: true,
      recovery_status: "needs_attention",
      failed_at: now,
      completed_at: now,
      last_heartbeat_at: now,
      trigger_run_id: triggerRunId ?? undefined,
    })
    .eq("id", importRunId)
    .in("status", ["queued", "starting", "running", "waiting"]);
}

export async function invokeGoogleSyncWorkerBatch(
  payload: GoogleWorkerPayload,
  action: GoogleSyncBatchAction,
  triggerRunId?: string,
): Promise<BatchWorkerResult> {
  const correlationId = payload.correlation_id ?? randomUUID();
  const body = {
    import_run_id: payload.import_run_id,
    correlation_id: correlationId,
    trigger_run_id: triggerRunId,
    action,
  };

  let resp: Response;
  try {
    resp = await invokeAgentWorker("google-sync-worker", body);
  } catch (e) {
    const failure = {
      message: e instanceof Error ? e.message : "Worker request failed.",
      code: "WORKER_INVOKE_FAILED",
    };
    await markGoogleImportRunFailed(payload.import_run_id, failure, triggerRunId, action);
    throw new Error(`${failure.code}: ${failure.message}`);
  }

  const text = await resp.text();
  if (!resp.ok) {
    const failure = parseWorkerError(resp.status, text);
    await markGoogleImportRunFailed(payload.import_run_id, failure, triggerRunId, action);
    throw new Error(`google-sync-worker failed (${resp.status}): ${JSON.stringify({ error: failure.message, code: failure.code })}`);
  }

  return JSON.parse(text) as BatchWorkerResult;
}

/** @deprecated Root orchestrator must not loop batches — use continuation tasks instead. */
export async function runBatchUntilDone(
  payload: GoogleWorkerPayload,
  action: GoogleSyncBatchAction,
  triggerRunId?: string,
  maxIterations = 500,
): Promise<BatchWorkerResult> {
  let last: BatchWorkerResult = { done: false };
  for (let i = 0; i < maxIterations; i++) {
    last = await invokeGoogleSyncWorkerBatch(payload, action, triggerRunId);
    if (last.done) return last;
  }
  throw new Error(`Batch ${action} exceeded max iterations (${maxIterations})`);
}

export async function invokeGoogleWorkerSmokeTest(): Promise<Record<string, unknown>> {
  const correlationId = randomUUID();
  const resp = await invokeAgentWorker("google-sync-worker", {
    mode: "auth_smoke_test",
    correlation_id: correlationId,
  });
  const text = await resp.text();
  if (!resp.ok) {
    const failure = parseWorkerError(resp.status, text);
    throw new Error(`google-sync-worker smoke test failed (${resp.status}): ${failure.code}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export type { GoogleWorkerPayload, BatchWorkerResult };
