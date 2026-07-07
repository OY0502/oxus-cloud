import type { AgentToolRun } from "@/lib/types";

/** Mirror of supabase/functions/_shared/agent/toolRunUtils.ts for the UI. */
export function isStaleAgentToolRun(toolRun: Pick<AgentToolRun, "status" | "started_at" | "trigger_run_id">): boolean {
  if (toolRun.status !== "running") return false;

  const startedMs = toolRun.started_at ? new Date(toolRun.started_at).getTime() : 0;
  if (!startedMs || Number.isNaN(startedMs)) return true;

  const ageMs = Date.now() - startedMs;
  if (!toolRun.trigger_run_id?.trim()) return ageMs > 15_000;
  return ageMs > 120_000;
}

export function isActionableAgentToolRun(toolRun: AgentToolRun): boolean {
  if (toolRun.status === "needs_confirmation" || toolRun.status === "pending") return true;
  if (toolRun.status === "failed" && toolRun.requires_confirmation !== false) return true;
  if (toolRun.status === "running") return isStaleAgentToolRun(toolRun);
  return false;
}

export function hasRunningAgentToolRuns(toolRuns: AgentToolRun[]): boolean {
  return toolRuns.some((run) => run.status === "running" && !isStaleAgentToolRun(run));
}
