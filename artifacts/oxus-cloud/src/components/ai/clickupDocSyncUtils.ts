import type { ProjectKnowledgeSource } from "@/lib/types";

export function formatClickupDocSourceMeta(source: ProjectKnowledgeSource): {
  parent: string | null;
  syncedAt: string | null;
  contentHash: string | null;
  changed: boolean;
  scopeStatus: string | null;
} {
  const meta = (source.metadata ?? {}) as Record<string, unknown>;
  return {
    parent: typeof meta.clickup_parent === "string" ? meta.clickup_parent : null,
    syncedAt: typeof meta.synced_at === "string" ? meta.synced_at : source.last_synced_at ?? null,
    contentHash: typeof meta.content_hash === "string" ? meta.content_hash.slice(0, 12) : null,
    changed: meta.content_changed === true,
    scopeStatus: source.sync_status && source.sync_status !== "active" ? source.sync_status : null,
  };
}

export function formatClickupDocSyncSummary(result: {
  docs_checked?: number;
  docs_imported?: number;
  docs_updated?: number;
  docs_skipped_unchanged?: number;
  docs_skipped_out_of_scope?: number;
  docs_marked_out_of_scope?: number;
  docs_unknown_scope?: number;
  active_clickup_docs?: number;
  out_of_scope_clickup_docs?: number;
  chunks_created?: number;
  chunks_updated?: number;
  chunks_deleted_or_replaced?: number;
  scope_parent?: string;
  scope_mode?: string;
  message?: string;
  memory_update_queued?: boolean;
  embedding_queued?: boolean;
  embedding_enabled?: boolean;
  retrieval_mode?: "vector" | "fallback";
  trigger_run_ids?: string[];
  async?: boolean;
  trigger_run_id?: string;
  trigger_environment?: string;
  fallback_used?: boolean;
  warning?: string;
  warnings?: string[];
}): string {
  if (result.warning) return result.warning;
  if (result.async && result.trigger_run_id) {
    const env = result.trigger_environment ? ` (${result.trigger_environment})` : "";
    return `Sync queued${env} (run ${result.trigger_run_id.slice(0, 8)}…). Results will appear after background processing.`;
  }
  if (result.message && (result.docs_imported ?? 0) + (result.docs_updated ?? 0) === 0) {
    return result.message;
  }

  const parts = [
    `${result.docs_checked ?? 0} checked`,
    `${result.docs_imported ?? 0} imported`,
    `${result.docs_updated ?? 0} updated`,
    `${result.docs_skipped_unchanged ?? 0} unchanged`,
    `${result.docs_skipped_out_of_scope ?? 0} skipped (out of scope)`,
  ];
  if ((result.docs_marked_out_of_scope ?? 0) > 0) {
    parts.push(`${result.docs_marked_out_of_scope} marked out of scope`);
  }
  if ((result.docs_unknown_scope ?? 0) > 0) {
    parts.push(`${result.docs_unknown_scope} unknown scope`);
  }

  const chunkPart =
    (result.chunks_created ?? 0) + (result.chunks_updated ?? 0) > 0
      ? ` Chunks: ${result.chunks_created ?? 0} created, ${result.chunks_updated ?? 0} updated.`
      : "";

  const scope = result.scope_parent ? ` Scope: ${result.scope_mode} → ${result.scope_parent}.` : "";
  const active = result.active_clickup_docs != null ? ` Active docs: ${result.active_clickup_docs}.` : "";
  const embedState =
    result.embedding_enabled === false
      ? " Embeddings disabled, using fallback retrieval."
      : result.memory_update_queued || result.embedding_queued
        ? ` Embedding: ${result.embedding_queued ? "queued" : "no"}. Memory: ${result.memory_update_queued ? "queued" : "no"}.`
        : " No memory merge queued (no content changes).";
  const retrieval =
    result.retrieval_mode === "fallback" ? " Retrieval mode: fallback." : "";

  const triggerIds =
    result.trigger_run_ids && result.trigger_run_ids.length > 0
      ? ` Trigger runs: ${result.trigger_run_ids.map((id) => id.slice(0, 8)).join(", ")}…`
      : "";

  const extraWarnings =
    result.warnings && result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";

  return `${parts.join(", ")}.${scope}${active}${chunkPart}${embedState}${retrieval}${triggerIds}${extraWarnings}`;
}
