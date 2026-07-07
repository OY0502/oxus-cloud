import type { ProjectPmActionItem } from "@/lib/types";

export function isOpenPmAction(item: ProjectPmActionItem): boolean {
  if (item.status === "dismissed" || item.status === "done") return false;
  if (item.execution_status === "succeeded" || item.execution_status === "skipped") return false;
  if (item.resolution_source === "clickup_signal" || item.auto_resolved_reason) return false;
  return item.status === "open" || item.status === "in_progress";
}

export function pmActionPriorityRank(priority: ProjectPmActionItem["priority"]): number {
  const ranks: Record<ProjectPmActionItem["priority"], number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return ranks[priority];
}

export function sortOpenPmActions<T extends ProjectPmActionItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pr = pmActionPriorityRank(a.priority) - pmActionPriorityRank(b.priority);
    if (pr !== 0) return pr;
    const aSignal = a.latest_signal_at ? new Date(a.latest_signal_at).getTime() : 0;
    const bSignal = b.latest_signal_at ? new Date(b.latest_signal_at).getTime() : 0;
    if (bSignal !== aSignal) return bSignal - aSignal;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function pmActionCategoryLabel(category: ProjectPmActionItem["category"]): string {
  if (category === "access_needed") return "Access Needed";
  return category.replace(/_/g, " ");
}

export function isClientQuestionAction(item: ProjectPmActionItem): boolean {
  return item.category === "client_question" || item.action_type === "ask_client_question";
}

export function isAccessBlockerAction(item: ProjectPmActionItem): boolean {
  return item.blocker_type === "access" || item.category === "access_needed" || item.action_type === "request_access";
}

export function copyTextForPmAction(item: ProjectPmActionItem): string {
  if (isAccessBlockerAction(item)) {
    const resource = item.blocker_resource ?? "the required resource";
    const actor = item.blocked_actor_name ?? "the team member";
    return `Could you please grant ${actor} access to ${resource}? They are currently blocked and cannot continue until access is provided.`;
  }
  return item.action_payload?.question_text ?? item.description ?? item.title;
}

const CLOSED_STATUSES = new Set([
  "complete",
  "completed",
  "closed",
  "done",
  "resolved",
  "cancelled",
  "canceled",
]);

export function isClickupTaskClosed(status: string | null | undefined): boolean {
  if (!status) return false;
  return CLOSED_STATUSES.has(status.toLowerCase().replace(/\s+/g, " ").trim());
}

export function pmActionClickupSynced(item: ProjectPmActionItem): boolean {
  return item.clickup_sync_status === "synced" || Boolean(item.clickup_task_id);
}

export function isPmActionClickupTaskCandidate(item: ProjectPmActionItem): boolean {
  if (pmActionClickupSynced(item)) return false;
  if (item.action_type === "create_clickup_task") return true;
  if (item.action_payload?.suggested_clickup_task === true) return true;
  if (item.action_payload?.suggested_action_type === "create_clickup_task") return true;
  const signalType = item.action_payload?.signal_type;
  return item.source_type === "slack" && signalType === "general_action";
}

export function isRepeatedBlockerAction(item: ProjectPmActionItem): boolean {
  if ((item.signal_count ?? 1) <= 1) return false;
  if (item.status === "done" || item.status === "dismissed") return false;
  const signalType = item.action_payload?.signal_type;
  if (signalType === "blocker" || signalType === "access_needed" || signalType === "blocked_work") {
    return true;
  }
  return (
    item.blocker_type === "access" ||
    item.category === "access_needed" ||
    item.action_type === "request_access"
  );
}

export type PmActionClickupPrefill = {
  title: string;
  description: string;
  priority: ProjectPmActionItem["priority"];
  assigneeIds: string[];
  dueDate: string;
  suggestedAssigneeNames: string[];
  suggestedDueDateText: string | null;
  assigneeMatchNote: string | null;
};

function payloadString(payload: ProjectPmActionItem["action_payload"], key: string): string | null {
  const value = payload?.[key as keyof typeof payload];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function pmActionClickupPrefill(item: ProjectPmActionItem): PmActionClickupPrefill {
  const payload = item.action_payload ?? {};
  const title =
    item.suggested_task_title?.trim() ||
    payloadString(payload, "suggested_task_title") ||
    item.title;
  const description =
    item.suggested_task_description?.trim() ||
    payloadString(payload, "suggested_task_description") ||
    item.description?.trim() ||
    "";
  const priority =
    item.suggested_priority ??
    item.priority ??
    "medium";
  const assigneeIds =
    (item.suggested_clickup_assignee_ids?.length ? item.suggested_clickup_assignee_ids : null) ??
    (item.selected_clickup_assignee_ids?.length ? item.selected_clickup_assignee_ids : []) ??
    [];
  const dueDate = item.suggested_due_date ?? item.selected_due_date ?? "";
  const suggestedAssigneeNames = item.suggested_assignee_names ?? [];
  const suggestedDueDateText = item.suggested_due_date_text ?? null;

  const unmatched = suggestedAssigneeNames.filter((name) => {
    if (assigneeIds.length > 0) return false;
    return name.trim().length > 0;
  });
  const assigneeMatchNote =
    unmatched.length > 0
      ? `Suggested assignee: ${unmatched.join(", ")}, but no matching ClickUp member was found.`
      : null;

  return {
    title,
    description,
    priority,
    assigneeIds,
    dueDate,
    suggestedAssigneeNames,
    suggestedDueDateText,
    assigneeMatchNote,
  };
}
