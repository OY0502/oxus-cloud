export const GOOGLE_IMPORT_MAX_AUTO_RETRIES = 3;

export const RECOVERABLE_GOOGLE_SYNC_ERROR_CODES = new Set([
  "WORKER_INVOKE_FAILED",
  "SYNC_FAILED",
  "MAX_DURATION_EXCEEDED",
  "STALE_RUN_RECONCILED",
  "IDLE_TIMEOUT",
  "RATE_LIMITED",
  "SERIALIZATION_CONFLICT",
  "TRANSIENT_PROVIDER_ERROR",
]);

export const NON_RECOVERABLE_GOOGLE_SYNC_ERROR_CODES = new Set([
  "INVALID_WORKER_PAYLOAD",
  "GOOGLE_CONNECTION_REVOKED",
  "GOOGLE_CONNECTION_NOT_FOUND",
  "GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT",
  "GOOGLE_SYNC_GENERATION_MISMATCH",
  "INTERNAL_AUTH_INVALID",
  "TRIGGER_NOT_CONFIGURED",
  "CANCELLED_BY_USER",
  "GOOGLE_SYNC_DISPATCH_FAILED",
]);

export type GoogleImportRecoveryStatus =
  | "idle"
  | "retrying"
  | "recovering"
  | "needs_attention";

export function classifyGoogleSyncError(code: string | null | undefined, message?: string | null): "recoverable" | "fatal" {
  const normalized = (code ?? "").trim().toUpperCase();
  if (NON_RECOVERABLE_GOOGLE_SYNC_ERROR_CODES.has(normalized)) return "fatal";
  if (RECOVERABLE_GOOGLE_SYNC_ERROR_CODES.has(normalized)) return "recoverable";

  const text = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (/timeout|timed out|econnreset|econnrefused|network|rate limit|429|503|502|serialization|deadlock|connection terminated|fetch failed|temporarily unavailable/.test(text)) {
    return "recoverable";
  }
  return "fatal";
}

export function recoveryBackoffMs(retryCount: number): number {
  const base = 1000;
  const max = 30_000;
  return Math.min(max, base * 2 ** Math.max(0, retryCount - 1));
}

/**
 * Skip only when there is credible recent activity.
 * Stale `retrying` rows must NOT be protected forever.
 */
export function shouldWatchdogSkipImport(input: {
  status: string;
  recovery_status?: string | null;
  next_retry_at?: string | null;
  finalization_heartbeat_at?: string | null;
  last_heartbeat_at?: string | null;
  retry_count?: number | null;
  action_required?: boolean | null;
}): boolean {
  const now = Date.now();
  if (input.next_retry_at) {
    const next = new Date(input.next_retry_at).getTime();
    if (!Number.isNaN(next) && next > now) return true;
  }
  if (input.finalization_heartbeat_at) {
    const hb = new Date(input.finalization_heartbeat_at).getTime();
    if (!Number.isNaN(hb) && now - hb < 15 * 60 * 1000) return true;
  }
  if (input.last_heartbeat_at) {
    const hb = new Date(input.last_heartbeat_at).getTime();
    if (!Number.isNaN(hb) && now - hb < 25 * 60 * 1000) return true;
  }
  // Fresh retrying/recovering without timestamps is rare; do not skip stale zombies.
  return false;
}

export function hasRetryBudget(retryCount?: number | null): boolean {
  return Number(retryCount ?? 0) < GOOGLE_IMPORT_MAX_AUTO_RETRIES;
}
