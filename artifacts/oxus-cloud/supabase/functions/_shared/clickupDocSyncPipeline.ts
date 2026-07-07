import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isEmbeddingsEnabled, embeddingsDisabledReason } from "./agent/embeddings.ts";
import { embedProjectKnowledgeChunks } from "./agent/retrieval.ts";
import { shouldQueueTriggerDevTasks, triggerDevTask } from "./agent/triggerDev.ts";
import {
  recordClickupDocsSyncTimelineEvent,
  syncClickupDocsForProject,
  type ClickupDocSyncResult,
} from "./clickupDocSync.ts";
import { mergeClickupDocsIntoProjectMemory } from "./clickupDocMemoryMerge.ts";

export async function queueClickupDocsPostProcessing(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  syncResult: ClickupDocSyncResult;
  runInline?: boolean;
}): Promise<
  Pick<
    ClickupDocSyncResult,
    "memory_update_queued" | "embedding_queued" | "trigger_run_ids" | "embedding_enabled" | "retrieval_mode"
  >
> {
  const hasContentChanges = args.syncResult.docs_imported + args.syncResult.docs_updated > 0;
  const triggerRunIds: string[] = [...args.syncResult.trigger_run_ids];
  const embeddingsEnabled = isEmbeddingsEnabled();
  const retrievalMode = embeddingsEnabled ? "vector" : "fallback";

  if (!embeddingsEnabled) {
    args.syncResult.warnings.push(
      `Embeddings disabled (${embeddingsDisabledReason()}), using fallback retrieval.`,
    );
  }

  if (!hasContentChanges) {
    return {
      memory_update_queued: false,
      embedding_queued: false,
      trigger_run_ids: triggerRunIds,
      embedding_enabled: embeddingsEnabled,
      retrieval_mode: retrievalMode,
    };
  }

  await recordClickupDocsSyncTimelineEvent({
    admin: args.admin,
    projectId: args.projectId,
    result: args.syncResult,
  });

  const shouldRunInline = args.runInline === true || !shouldQueueTriggerDevTasks();

  if (shouldRunInline) {
    if (embeddingsEnabled) {
      await embedProjectKnowledgeChunks({
        admin: args.admin,
        projectId: args.projectId,
      });
    }
    await mergeClickupDocsIntoProjectMemory({
      admin: args.admin,
      projectId: args.projectId,
      userId: args.userId,
      sourceIds: args.syncResult.changed_source_ids,
      docsImported: args.syncResult.docs_imported,
      docsUpdated: args.syncResult.docs_updated,
    });
    return {
      memory_update_queued: true,
      embedding_queued: embeddingsEnabled,
      trigger_run_ids: triggerRunIds,
      embedding_enabled: embeddingsEnabled,
      retrieval_mode: retrievalMode,
    };
  }

  let embeddingQueued = false;
  let memoryQueued = false;

  if (embeddingsEnabled) {
    try {
      const embedRun = await triggerDevTask("embed-project-knowledge", { project_id: args.projectId });
      embeddingQueued = true;
      triggerRunIds.push(embedRun.id);
    } catch (e) {
      args.syncResult.warnings.push(`Embedding queue failed: ${(e as Error).message}`);
    }
  }

  try {
    const mergeRun = await triggerDevTask("merge-project-memory-from-docs", {
      project_id: args.projectId,
      user_id: args.userId,
      source_ids: args.syncResult.changed_source_ids,
      docs_imported: args.syncResult.docs_imported,
      docs_updated: args.syncResult.docs_updated,
    });
    memoryQueued = true;
    triggerRunIds.push(mergeRun.id);
  } catch (e) {
    args.syncResult.warnings.push(`Memory update queue failed: ${(e as Error).message}`);
  }

  return {
    memory_update_queued: memoryQueued,
    embedding_queued: embeddingQueued,
    trigger_run_ids: triggerRunIds,
    embedding_enabled: embeddingsEnabled,
    retrieval_mode: retrievalMode,
  };
}

export { syncClickupDocsForProject, type ClickupDocSyncResult };
