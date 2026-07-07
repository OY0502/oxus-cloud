/** Idempotent PM action upsert from signals — prevents duplicate inserts. */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  findExistingActionForSignal,
  proposedFromCandidate,
  recordActionSuppression,
  suppressionReasonFromMatch,
  type ProposedPmAction,
  type SuppressionReason,
} from "./pmActionSuppression.ts";

export type UpsertPmActionInput = {
  project_id: string;
  status_report_id?: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status?: string;
  source: string;
  source_type: string;
  source_app?: string | null;
  source_label?: string | null;
  source_actor_name?: string | null;
  source_message?: string | null;
  source_message_ts?: string | null;
  source_thread_key?: string | null;
  source_external_id?: string | null;
  source_metadata?: Record<string, unknown>;
  action_type: string;
  action_payload: Record<string, unknown>;
  action_key?: string | null;
  action_identity: string;
  source_event_ids?: string[];
  source_signal_ids?: string[];
  signal_type?: string | null;
  signal_at?: string;
  signal_count?: number;
  change_history?: unknown[];
  execution_status?: string;
  created_by?: string | null;
  is_escalation?: boolean;
  suggested_task_title?: string | null;
  suggested_task_description?: string | null;
  suggested_assignee_names?: string[];
  suggested_clickup_assignee_ids?: string[];
  suggested_due_date?: string | null;
  suggested_due_date_text?: string | null;
  suggested_priority?: string | null;
  task_draft_metadata?: Record<string, unknown>;
};

export type UpsertPmActionOutcome =
  | "created"
  | "updated"
  | "suppressed"
  | "duplicate_avoided"
  | "reopened";

export type UpsertPmActionResult = {
  outcome: UpsertPmActionOutcome;
  action_id: string | null;
  reason: string;
  suppression_reason?: SuppressionReason;
  item?: Record<string, unknown>;
};

const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

const ALLOWED_PM_ACTION_SOURCE_TYPES = new Set([
  "slack",
  "clickup",
  "zoom",
  "figma",
  "github",
  "manual",
  "ai",
  "other",
]);

/** Map legacy `source` values to DB-allowed `source_type` check constraint values. */
export function normalizePmActionSourceType(source: string, sourceType?: string | null): string {
  const raw = (sourceType?.trim() || source.trim()).toLowerCase();
  if (ALLOWED_PM_ACTION_SOURCE_TYPES.has(raw)) return raw;
  if (raw === "ai_status_report") return "ai";
  if (raw === "clickup_timeline") return "clickup";
  return "other";
}

function raisePriority(current: string, next: string): string {
  return (PRIORITY_RANK[next] ?? 2) > (PRIORITY_RANK[current] ?? 2) ? next : current;
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0))];
}

function uniqueUuids(values: (string | null | undefined)[]): string[] {
  return uniqueStrings(values);
}

function taskDraftPatch(input: UpsertPmActionInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.suggested_task_title !== undefined) patch.suggested_task_title = input.suggested_task_title;
  if (input.suggested_task_description !== undefined) {
    patch.suggested_task_description = input.suggested_task_description;
  }
  if (input.suggested_assignee_names !== undefined) {
    patch.suggested_assignee_names = input.suggested_assignee_names;
  }
  if (input.suggested_clickup_assignee_ids !== undefined) {
    patch.suggested_clickup_assignee_ids = input.suggested_clickup_assignee_ids;
  }
  if (input.suggested_due_date !== undefined) patch.suggested_due_date = input.suggested_due_date;
  if (input.suggested_due_date_text !== undefined) {
    patch.suggested_due_date_text = input.suggested_due_date_text;
  }
  if (input.suggested_priority !== undefined) patch.suggested_priority = input.suggested_priority;
  if (input.task_draft_metadata !== undefined) patch.task_draft_metadata = input.task_draft_metadata;
  return patch;
}

function appendChangeHistory(existing: unknown[], entry: Record<string, unknown>): Record<string, unknown>[] {
  return [...(Array.isArray(existing) ? existing : []), entry];
}

export async function loadProjectPmActionsForUpsert(
  admin: SupabaseClient,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin
    .from("project_pm_action_items")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

function findByIdentity(items: Record<string, unknown>[], identity: string): Record<string, unknown> | null {
  return items.find((item) => item.action_identity === identity) ?? null;
}

function proposedFromInput(input: UpsertPmActionInput): ProposedPmAction {
  return proposedFromCandidate({
    action_key: input.action_key ?? null,
    action_identity: input.action_identity,
    source_thread_key: input.source_thread_key ?? null,
    source_type: input.source_type,
    signal_type: input.signal_type ?? null,
    action_type: input.action_type,
    category: input.category,
    title: input.title,
    source_message: input.source_message ?? null,
    source_event_ids: input.source_event_ids ?? [],
    source_signal_ids: input.source_signal_ids ?? [],
    action_payload: {
      ...input.action_payload,
      action_identity: input.action_identity,
      source_signal_ids: input.source_signal_ids ?? [],
    },
    is_escalation: input.is_escalation,
  });
}

export async function upsertPmActionFromSignal(args: {
  admin: SupabaseClient;
  input: UpsertPmActionInput;
  existingItems: Record<string, unknown>[];
}): Promise<UpsertPmActionResult & { workingItems: Record<string, unknown>[] }> {
  const now = args.input.signal_at ?? new Date().toISOString();
  const proposed = proposedFromInput(args.input);
  let match = findExistingActionForSignal(args.existingItems, proposed);

  const byIdentity = findByIdentity(args.existingItems, args.input.action_identity);
  if (byIdentity && !match.item) {
    const status = byIdentity.status as string;
    if (status === "open" || status === "in_progress") {
      match = { kind: "open", item: byIdentity, shouldSuppress: false, shouldUpdate: true, shouldReopen: false };
    } else if (status === "dismissed" || byIdentity.resolution_source === "dismissed") {
      match = {
        kind: "dismissed",
        item: byIdentity,
        shouldSuppress: true,
        shouldUpdate: false,
        shouldReopen: false,
        suppressionReason: "suppressed_by_dismissed_action",
      };
    } else if (status === "done") {
      match = {
        kind: "done",
        item: byIdentity,
        shouldSuppress: true,
        shouldUpdate: false,
        shouldReopen: false,
        suppressionReason: "suppressed_by_completed_action",
      };
    }
  }

  if (match.shouldSuppress && match.item) {
    await recordActionSuppression({
      supabase: args.admin,
      dismissedAction: match.item,
      signalAt: now,
    });
    return {
      outcome: "suppressed",
      action_id: String(match.item.id),
      reason: match.suppressionReason ?? "suppressed_by_dismissed_action",
      suppression_reason: suppressionReasonFromMatch(match, proposed) ?? undefined,
      item: match.item,
      workingItems: args.existingItems,
    };
  }

  const existing = match.item;
  const workingItems = [...args.existingItems];

  if (existing && (existing.status === "open" || existing.status === "in_progress" || match.shouldReopen)) {
    const mergedSignalIds = uniqueUuids([
      ...((existing.source_signal_ids as string[] | undefined) ?? []),
      ...(args.input.source_signal_ids ?? []),
    ]);
    const mergedEventIds = uniqueStrings([
      ...((existing.source_event_ids as string[] | undefined) ?? []),
      ...(args.input.source_event_ids ?? []),
    ]);
    const prevPayload = (existing.action_payload ?? {}) as Record<string, unknown>;
    let changeHistory = Array.isArray(existing.change_history) ? existing.change_history : args.input.change_history ?? [];

    if (
      args.input.action_payload.meeting_date_text &&
      prevPayload.meeting_date_text &&
      args.input.action_payload.meeting_date_text !== prevPayload.meeting_date_text
    ) {
      changeHistory = appendChangeHistory(changeHistory, {
        at: now,
        type: "date_changed",
        from: prevPayload.meeting_date_text,
        to: args.input.action_payload.meeting_date_text,
        message: args.input.source_message,
      });
    }

    const patch: Record<string, unknown> = {
      title: args.input.title,
      description: args.input.description,
      priority: raisePriority(String(existing.priority ?? "medium"), args.input.priority),
      action_type:
        existing.clickup_sync_status === "synced" || existing.clickup_task_id
          ? existing.action_type
          : args.input.action_type ?? existing.action_type,
      action_payload: { ...prevPayload, ...args.input.action_payload, source_signal_ids: mergedSignalIds },
      action_key: args.input.action_key ?? existing.action_key,
      action_identity: args.input.action_identity,
      source_signal_ids: mergedSignalIds,
      source_event_ids: mergedEventIds,
      source_message: args.input.source_message ?? existing.source_message,
      source_message_ts: args.input.source_message_ts ?? existing.source_message_ts,
      source_metadata: { ...((existing.source_metadata ?? {}) as object), ...(args.input.source_metadata ?? {}) },
      source_actor_name: args.input.source_actor_name ?? existing.source_actor_name,
      change_history: changeHistory,
      signal_count: (Number(existing.signal_count) || 1) + 1,
      latest_signal_at: now,
      last_signal_summary: args.input.source_message?.slice(0, 200) ?? existing.last_signal_summary,
      last_dedupe_check_at: now,
      ...taskDraftPatch(args.input),
    };

    if (
      !(existing.clickup_sync_status === "synced" || existing.clickup_task_id) &&
      args.input.suggested_clickup_assignee_ids?.length &&
      !(Array.isArray(existing.selected_clickup_assignee_ids) && existing.selected_clickup_assignee_ids.length > 0)
    ) {
      patch.selected_clickup_assignee_ids = args.input.suggested_clickup_assignee_ids;
    }
    if (
      !(existing.clickup_sync_status === "synced" || existing.clickup_task_id) &&
      args.input.suggested_due_date &&
      !existing.selected_due_date
    ) {
      patch.selected_due_date = args.input.suggested_due_date;
    }

    if (match.shouldReopen) {
      patch.status = "open";
      patch.completed_at = null;
      patch.executed_at = null;
      patch.resolution_note = null;
    }

    const { data, error } = await args.admin
      .from("project_pm_action_items")
      .update(patch)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    const idx = workingItems.findIndex((row) => row.id === existing.id);
    if (idx >= 0) workingItems[idx] = data;
    else workingItems.unshift(data);

    return {
      outcome: match.shouldReopen ? "reopened" : "updated",
      action_id: String(data.id),
      reason: "duplicate_open_action_updated",
      item: data as Record<string, unknown>,
      workingItems,
    };
  }

  if (existing && existing.status === "done") {
    return {
      outcome: "duplicate_avoided",
      action_id: String(existing.id),
      reason: "suppressed_by_completed_action",
      item: existing,
      workingItems,
    };
  }

  const insertRow = {
    project_id: args.input.project_id,
    status_report_id: args.input.status_report_id ?? null,
    title: args.input.title,
    description: args.input.description,
    category: args.input.category,
    priority: args.input.priority,
    status: args.input.status ?? "open",
    source: args.input.source,
    source_type: normalizePmActionSourceType(args.input.source, args.input.source_type),
    source_app: args.input.source_app ?? null,
    source_label: args.input.source_label ?? null,
    source_actor_name: args.input.source_actor_name ?? null,
    source_message: args.input.source_message ?? null,
    source_message_ts: args.input.source_message_ts ?? null,
    source_thread_key: args.input.source_thread_key ?? null,
    source_external_id: args.input.source_external_id ?? null,
    source_metadata: args.input.source_metadata ?? {},
    action_type: args.input.action_type,
    action_payload: args.input.action_payload,
    action_key: args.input.action_key ?? null,
    action_identity: args.input.action_identity,
    source_event_ids: args.input.source_event_ids ?? [],
    source_signal_ids: args.input.source_signal_ids ?? [],
    execution_status: args.input.execution_status ?? "not_started",
    change_history: args.input.change_history ?? [],
    signal_count: args.input.signal_count ?? 1,
    first_signal_at: now,
    latest_signal_at: now,
    last_signal_summary: args.input.source_message?.slice(0, 200) ?? null,
    created_by: args.input.created_by ?? null,
    last_dedupe_check_at: now,
    selected_clickup_assignee_ids: args.input.suggested_clickup_assignee_ids ?? [],
    selected_due_date: args.input.suggested_due_date ?? null,
    selected_due_date_time: false,
    ...taskDraftPatch(args.input),
  };

  const { data, error } = await args.admin
    .from("project_pm_action_items")
    .insert(insertRow)
    .select()
    .single();
  if (error) throw new Error(error.message);

  workingItems.unshift(data);
  return {
    outcome: "created",
    action_id: String(data.id),
    reason: "created_new_action",
    item: data as Record<string, unknown>,
    workingItems,
  };
}
