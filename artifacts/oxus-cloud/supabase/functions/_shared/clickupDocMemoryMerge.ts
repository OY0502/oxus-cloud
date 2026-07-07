import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateMemoryUpdate } from "./agent/aiModel.ts";
import { executeUpdateProjectMemory } from "./agent/tools.ts";
import { createLangfuseTrace, patchLangfuseTrace } from "./agent/langfuse.ts";
import { buildSuppressedQuestionKeys } from "./memoryMerge.ts";

const MAX_MERGE_CHARS = Number(Deno.env.get("CLICKUP_DOC_MEMORY_MERGE_MAX_CHARS") ?? "120000");

export type MergeClickupDocsMemoryResult = {
  model: string;
  trace_id: string | null;
  chunks_used: number;
  summary: string;
};

export async function mergeClickupDocsIntoProjectMemory(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  sourceIds: string[];
  docsImported: number;
  docsUpdated: number;
}): Promise<MergeClickupDocsMemoryResult> {
  if (args.sourceIds.length === 0) {
    return { model: "", trace_id: null, chunks_used: 0, summary: "No changed docs to merge." };
  }

  const { data: chunks } = await args.admin
    .from("project_knowledge_chunks")
    .select("id, content, source_id, metadata")
    .eq("project_id", args.projectId)
    .in("source_id", args.sourceIds)
    .order("source_id")
    .order("chunk_index");

  const chunkRows = chunks ?? [];
  if (chunkRows.length === 0) {
    return { model: "", trace_id: null, chunks_used: 0, summary: "No doc chunks available for memory merge." };
  }

  let combined = chunkRows.map((c) => String(c.content ?? "")).join("\n\n");
  if (combined.length > MAX_MERGE_CHARS) {
    combined = combined.slice(0, MAX_MERGE_CHARS);
  }

  const { data: existingProfile } = await args.admin
    .from("project_pm_profiles")
    .select("*")
    .eq("project_id", args.projectId)
    .maybeSingle();

  const { data: projectRow } = await args.admin
    .from("projects")
    .select("name, client_name, project_type")
    .eq("id", args.projectId)
    .maybeSingle();

  const { data: suppressedRows } = await args.admin
    .from("project_pm_attention_items")
    .select("question, status")
    .eq("project_id", args.projectId)
    .in("status", ["skipped", "cleared", "answered"]);

  const suppressedKeys = buildSuppressedQuestionKeys(suppressedRows ?? []);

  const traceHandle = await createLangfuseTrace({
    name: "mergeClickupDocsMemory",
    metadata: {
      project_id: args.projectId,
      source_type: "clickup_doc",
      docs_imported: args.docsImported,
      docs_updated: args.docsUpdated,
      chunks_used: chunkRows.length,
    },
    input: { source_ids: args.sourceIds, chars: combined.length },
  });

  const { data: memoryResult, model, traceId } = await generateMemoryUpdate({
    inputText: `ClickUp documentation sync — merge the following doc content into project memory:\n\n${combined}`,
    existingProfile: existingProfile as Record<string, unknown> | null,
    suppressedQuestionKeys: suppressedKeys,
    projectName: (projectRow as { name?: string | null } | null)?.name ?? null,
    clientName: (projectRow as { client_name?: string | null } | null)?.client_name ?? null,
    projectType: (projectRow as { project_type?: string | null } | null)?.project_type ?? null,
    trace: {
      project_id: args.projectId,
      source_type: "clickup_doc",
      docs_imported: args.docsImported,
      docs_updated: args.docsUpdated,
      chunks_used: chunkRows.length,
    },
  });

  const primarySourceId = args.sourceIds[0];
  await executeUpdateProjectMemory({
    admin: args.admin,
    projectId: args.projectId,
    userId: args.userId,
    memoryUpdates: memoryResult.memory_updates,
    sourceId: primarySourceId,
    suppressedQuestionKeys: suppressedKeys,
  });

  await args.admin.from("ai_project_briefs").insert({
    project_id: args.projectId,
    source_type: "other",
    source_text: combined.slice(0, 50000),
    summary: memoryResult.summary,
    status: "completed",
    model,
    raw_response: {
      source_type: "clickup_doc",
      docs_imported: args.docsImported,
      docs_updated: args.docsUpdated,
      source_ids: args.sourceIds,
    },
    created_by: args.userId,
  });

  const resolvedTraceId = traceId ?? traceHandle?.traceId ?? null;
  if (resolvedTraceId) {
    await patchLangfuseTrace(resolvedTraceId, {
      output: { summary: memoryResult.summary, model, chunks_used: chunkRows.length },
      metadata: {
        project_id: args.projectId,
        source_type: "clickup_doc",
        docs_imported: args.docsImported,
        docs_updated: args.docsUpdated,
        chunks_used: chunkRows.length,
        model,
      },
    });
  }

  return {
    model,
    trace_id: resolvedTraceId,
    chunks_used: chunkRows.length,
    summary: memoryResult.summary,
  };
}
