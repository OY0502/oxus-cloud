/** Detect tool runs stuck in `running` (e.g. Trigger handoff failed mid-confirm). */
export function isStaleAgentToolRun(toolRun: {
  status: string;
  started_at?: string | null;
  trigger_run_id?: string | null;
}): boolean {
  if (toolRun.status !== "running") return false;

  const startedMs = toolRun.started_at ? new Date(toolRun.started_at).getTime() : 0;
  if (!startedMs || Number.isNaN(startedMs)) return true;

  const ageMs = Date.now() - startedMs;
  // Sync path marked running but never finished (Trigger fallback bug, edge timeout, etc.)
  if (!toolRun.trigger_run_id?.trim()) return ageMs > 15_000;
  // Async Trigger run with no worker completion
  return ageMs > 120_000;
}

export function isConfirmableAgentToolRun(toolRun: {
  status: string;
  started_at?: string | null;
  trigger_run_id?: string | null;
}): boolean {
  const confirmable = ["needs_confirmation", "pending", "confirmed", "failed", "cancelled"];
  return confirmable.includes(toolRun.status) || isStaleAgentToolRun(toolRun);
}
