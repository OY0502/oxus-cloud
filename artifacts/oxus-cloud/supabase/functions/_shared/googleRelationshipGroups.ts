import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  normalizeEmail,
  isAutomatedSender,
  isInternalOxusEmail,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import type { SyncCounts } from "./googleSyncWorker.ts";

const ANALYSIS_VERSION = "v2";
const PROMPT_VERSION = "relationship-group-v1";

export function relationshipGroupKey(connectionId: string, email: string): string {
  return `${connectionId}:${normalizeEmail(email) ?? email.toLowerCase()}`;
}

export function bump(counts: SyncCounts, key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

export async function batchFilterEnrichmentThreads(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  limit: number,
  counts: SyncCounts,
): Promise<{ processed: number; done: boolean }> {
  const { data: rows } = await admin
    .from("google_gmail_threads")
    .select("id, enrichment_status, enrichment_priority, relevance_reason")
    .eq("connection_id", connection.id)
    .eq("relevance_status", "relevant")
    .in("enrichment_status", ["pending", "metadata_resolved"])
    .limit(limit);

  if (!rows?.length) return { processed: 0, done: true };

  for (const row of rows) {
    const eligible = (row.enrichment_priority ?? 0) >= 55
      && !String(row.relevance_reason ?? "").includes("metadata_only")
      && !String(row.relevance_reason ?? "").includes("noise");

    await admin.from("google_gmail_threads").update({
      enrichment_status: eligible ? "queued" : "noise",
    }).eq("id", row.id);

    if (eligible) bump(counts, "threads_selected_for_ai");
    else bump(counts, "threads_skipped_as_noise");
  }

  const { count: remaining } = await admin
    .from("google_gmail_threads")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .eq("relevance_status", "relevant")
    .in("enrichment_status", ["pending", "metadata_resolved"]);

  return { processed: rows.length, done: (remaining ?? 0) === 0 };
}

export async function batchGroupRelationshipThreads(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  importRunId: string,
  limit: number,
  counts: SyncCounts,
): Promise<{ processed: number; done: boolean }> {
  const { data: rows } = await admin
    .from("google_gmail_threads")
    .select("id, thread_id, participant_emails, enrichment_priority, metadata, subject")
    .eq("connection_id", connection.id)
    .eq("enrichment_status", "queued")
    .is("relationship_group_id", null)
    .order("enrichment_priority", { ascending: false })
    .limit(limit);

  if (!rows?.length) return { processed: 0, done: true };

  const groups = new Map<string, {
    email: string;
    threadIds: string[];
    rowIds: string[];
    priority: number;
  }>();

  for (const row of rows) {
    const meta = row.metadata as Record<string, unknown> | null;
    const primary = normalizeEmail(String(meta?.primary_external_email ?? ""));
    const participants = (row.participant_emails as string[] ?? [])
      .map((e) => normalizeEmail(e))
      .filter((e): e is string => !!e && !isInternalOxusEmail(e) && !isAutomatedSender(e));
    const email = primary ?? participants[0];
    if (!email) {
      await admin.from("google_gmail_threads").update({ enrichment_status: "skipped" }).eq("id", row.id);
      bump(counts, "threads_skipped_as_noise");
      continue;
    }

    const key = relationshipGroupKey(connection.id, email);
    const existing = groups.get(key) ?? { email, threadIds: [], rowIds: [], priority: 0 };
    existing.threadIds.push(row.thread_id);
    existing.rowIds.push(row.id);
    existing.priority = Math.max(existing.priority, row.enrichment_priority ?? 0);
    groups.set(key, existing);
  }

  for (const [groupKey, group] of groups) {
    const { data: upserted } = await admin.from("google_relationship_groups").upsert(
      {
        connection_id: connection.id,
        import_run_id: importRunId,
        owner_user_id: connection.user_id,
        group_key: groupKey,
        normalized_external_email: group.email,
        thread_ids: group.threadIds,
        thread_count: group.threadIds.length,
        priority_score: group.priority,
        status: "pending",
        analysis_version: ANALYSIS_VERSION,
        prompt_version: PROMPT_VERSION,
      },
      { onConflict: "connection_id,group_key" },
    ).select("id").single();

    if (upserted?.id) {
      await admin.from("google_gmail_threads").update({
        relationship_group_id: upserted.id,
        enrichment_status: "grouped",
      }).in("id", group.rowIds);
      bump(counts, "relationship_groups_queued");
    }
  }

  const { count: remaining } = await admin
    .from("google_gmail_threads")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .eq("enrichment_status", "queued")
    .is("relationship_group_id", null);

  return { processed: rows.length, done: (remaining ?? 0) === 0 };
}

export async function loadRelationshipGroupsForEnrichment(
  admin: SupabaseClient,
  connectionId: string,
  limit: number,
): Promise<Array<{
  id: string;
  normalized_external_email: string;
  thread_ids: string[];
  thread_count: number;
  content_hash: string | null;
  priority_score: number;
}>> {
  const { data } = await admin
    .from("google_relationship_groups")
    .select("id, normalized_external_email, thread_ids, thread_count, content_hash, priority_score")
    .eq("connection_id", connectionId)
    .in("status", ["pending", "queued"])
    .order("priority_score", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export { ANALYSIS_VERSION, PROMPT_VERSION };
