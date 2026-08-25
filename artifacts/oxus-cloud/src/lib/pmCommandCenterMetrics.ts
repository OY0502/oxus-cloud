import type { PmOpenActionItem, PmProjectAttention, PmStaleClickupTask } from "@/lib/types";
import { isClientQuestionAction } from "@/lib/pmActions";
import type { PmCommandCenterCollapseState } from "@/lib/pmCommandCenterStorage";

export interface PmCommandCenterMetrics {
  needingAttention: number;
  urgentBlockers: number;
  clientQuestions: number;
  needsAnalysis: number;
  staleTasks: number;
}

export function computePmCommandCenterMetrics(
  openActions: PmOpenActionItem[],
  attentionProjects: PmProjectAttention[],
  staleTasks: PmStaleClickupTask[],
): PmCommandCenterMetrics {
  const urgentBlockers = openActions.filter(
    (a) =>
      (a.blocker_type || a.category === "access_needed") &&
      (a.priority === "urgent" || a.priority === "high"),
  ).length;
  const clientQuestions = openActions.filter(isClientQuestionAction).length;
  const needsAnalysis = attentionProjects.filter((p) => p.needs_ai_review).length;
  return {
    needingAttention: attentionProjects.length,
    urgentBlockers,
    clientQuestions,
    needsAnalysis,
    staleTasks: staleTasks.length,
  };
}

export function isPmCommandCenterAllClear(
  metrics: PmCommandCenterMetrics,
  openActionCount: number,
): boolean {
  return (
    metrics.needingAttention === 0 &&
    metrics.urgentBlockers === 0 &&
    metrics.clientQuestions === 0 &&
    metrics.needsAnalysis === 0 &&
    metrics.staleTasks === 0 &&
    openActionCount === 0
  );
}

export function pmCommandCenterCollapsedSummary(metrics: PmCommandCenterMetrics): string {
  const parts: string[] = [];
  if (metrics.urgentBlockers > 0) {
    parts.push(
      `${metrics.urgentBlockers} urgent blocker${metrics.urgentBlockers === 1 ? "" : "s"}`,
    );
  }
  if (metrics.needingAttention > 0) {
    parts.push(
      `${metrics.needingAttention} project${metrics.needingAttention === 1 ? "" : "s"} need attention`,
    );
  }
  if (metrics.needsAnalysis > 0 && metrics.needingAttention === 0) {
    parts.push(
      `${metrics.needsAnalysis} project${metrics.needsAnalysis === 1 ? "" : "s"} need analysis`,
    );
  }
  if (metrics.clientQuestions > 0) {
    parts.push(
      `${metrics.clientQuestions} client question${metrics.clientQuestions === 1 ? "" : "s"}`,
    );
  }
  if (metrics.staleTasks > 0) {
    parts.push(`${metrics.staleTasks} stale task${metrics.staleTasks === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function resolveInitialPmCommandCenterCollapsed(
  stored: PmCommandCenterCollapseState | null,
  metrics: PmCommandCenterMetrics,
  openActionCount: number,
): boolean {
  if (stored?.manual) return stored.collapsed;
  if (isPmCommandCenterAllClear(metrics, openActionCount)) return true;
  if (metrics.urgentBlockers > 0) return false;
  if (openActionCount === 0 && metrics.urgentBlockers === 0) return true;
  return stored?.collapsed ?? false;
}
