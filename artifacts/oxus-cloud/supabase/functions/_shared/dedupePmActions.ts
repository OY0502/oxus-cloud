/** Merge duplicate PM action items by action_identity and thread keys. */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeSlug } from "./pmActionDedupe.ts";
import { parseSlackActionIdentity } from "./pmActionIdentity.ts";
import { actionFamilyFromItem } from "./pmActionSuppression.ts";

export type DedupePmActionsResult = {
  duplicates_found: number;
  items_merged: number;
  canonical_ids: string[];
  dismissed_ids: string[];
  dry_run: boolean;
  groups: Array<{
    key: string;
    keeper_id: string;
    duplicate_ids: string[];
  }>;
};

function groupKey(item: Record<string, unknown>): string | null {
  if (typeof item.action_identity === "string" && item.action_identity.trim()) {
    return item.action_identity;
  }
  const family = actionFamilyFromItem(item);
  if (typeof item.source_thread_key === "string" && item.source_thread_key.trim() && family) {
    return `thread_family:${item.source_thread_key}:${family}`;
  }
  const payload = (item.action_payload ?? {}) as Record<string, unknown>;
  if (typeof payload.slack_thread_key === "string" && family) {
    return `thread_family:${payload.slack_thread_key}:${family}`;
  }
  if (typeof item.source_thread_key === "string" && item.source_thread_key.trim()) {
    const signalType = payload.signal_type ?? "general";
    return `thread:${item.source_thread_key}:${signalType}`;
  }
  if (typeof payload.slack_thread_key === "string") {
    return `slack_thread:${payload.slack_thread_key}`;
  }
  if (typeof item.title === "string" && typeof item.source_thread_key === "string") {
    return `title_thread:${normalizeSlug(item.title, "title")}:${item.source_thread_key}`;
  }
  const parsed = parseSlackActionIdentity(item.action_identity as string | undefined);
  if (parsed) return `slack:${parsed.channelId}:${parsed.threadTs}:${parsed.actionFamily}`;
  return null;
}

function pickKeeper(group: Record<string, unknown>[]): Record<string, unknown> {
  const done = group.filter((item) => item.status === "done");
  if (done.length > 0) {
    return done.sort(
      (a, b) => new Date(String(a.completed_at ?? a.updated_at)).getTime() -
        new Date(String(b.completed_at ?? b.updated_at)).getTime(),
    )[0];
  }

  const dismissed = group.filter((item) => item.status === "dismissed");
  if (dismissed.length === group.length) {
    return dismissed.sort(
      (a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime(),
    )[0];
  }

  const open = group.filter((item) => item.status === "open" || item.status === "in_progress");
  if (open.length > 0) {
    return open.sort(
      (a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime(),
    )[0];
  }

  return group.sort(
    (a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime(),
  )[0];
}

export async function dedupePmActionsForProject(args: {
  admin: SupabaseClient;
  projectId: string;
  dryRun?: boolean;
}): Promise<DedupePmActionsResult> {
  const { data: items, error } = await args.admin
    .from("project_pm_action_items")
    .select("*")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (items ?? []) as Record<string, unknown>[];
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const item of rows) {
    const key = groupKey(item);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  const result: DedupePmActionsResult = {
    duplicates_found: 0,
    items_merged: 0,
    canonical_ids: [],
    dismissed_ids: [],
    dry_run: args.dryRun ?? false,
    groups: [],
  };

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    result.duplicates_found += group.length - 1;

    const keeper = pickKeeper(group);
    const duplicates = group.filter((item) => item.id !== keeper.id);
    result.groups.push({
      key,
      keeper_id: String(keeper.id),
      duplicate_ids: duplicates.map((item) => String(item.id)),
    });
    result.canonical_ids.push(String(keeper.id));

    if (args.dryRun) continue;

    let signalCount = Number(keeper.signal_count) || 1;
    let suppressedCount = Number(keeper.suppressed_signal_count) || 0;
    const mergedSignalIds = [...((keeper.source_signal_ids as string[] | undefined) ?? [])];
    const mergedHistory = [...((keeper.change_history as unknown[] | undefined) ?? [])];

    for (const dup of duplicates) {
      signalCount += Number(dup.signal_count) || 1;
      suppressedCount += Number(dup.suppressed_signal_count) || 0;
      mergedSignalIds.push(...((dup.source_signal_ids as string[] | undefined) ?? []));
      mergedHistory.push(...((dup.change_history as unknown[] | undefined) ?? []));

      await args.admin
        .from("project_pm_action_items")
        .update({
          status: "dismissed",
          dismiss_reason: `Merged into duplicate action ${keeper.id}`,
          resolution_source: "dedupe",
          resolution_note: `Merged into action ${keeper.id} during duplicate cleanup.`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", dup.id);
      result.dismissed_ids.push(String(dup.id));
      result.items_merged++;
    }

    await args.admin
      .from("project_pm_action_items")
      .update({
        signal_count: signalCount,
        suppressed_signal_count: suppressedCount,
        source_signal_ids: [...new Set(mergedSignalIds)],
        change_history: mergedHistory,
        action_identity: keeper.action_identity ?? key,
        last_dedupe_check_at: new Date().toISOString(),
      })
      .eq("id", keeper.id);
  }

  return result;
}
