import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embedQuery, embedTexts, embeddingConfig, isEmbeddingsEnabled, embeddingsDisabledReason, MIN_CHUNK_CHARS, DEFAULT_BATCH } from "./embeddings.ts";
import { loadActiveKnowledgeSourceIds } from "../knowledgeSourceScope.ts";
import type { RetrievalChunk } from "./types.ts";

export type EmbedProjectKnowledgeResult = {
  embedded_count: number;
  skipped_count: number;
  model: string;
  embedding_enabled: boolean;
  embedding_skipped?: boolean;
  reason?: string;
  retrieval_mode: "vector" | "fallback";
};

export async function retrieveProjectKnowledge(args: {
  admin: SupabaseClient;
  projectId: string;
  queryText: string;
  matchCount?: number;
}): Promise<{
  chunks: RetrievalChunk[];
  mode: "vector" | "fallback";
  clickup_doc_chunks_retrieved: number;
  active_clickup_doc_sources: number;
  excluded_out_of_scope_sources: number;
  embeddings_enabled: boolean;
  embedding_provider: string;
  embedding_skip_reason?: string;
}> {
  const matchCount = args.matchCount ?? 10;
  const embedCfg = embeddingConfig();
  const embeddingsEnabled = isEmbeddingsEnabled();
  const embeddingSkipReason = embeddingsEnabled ? undefined : embeddingsDisabledReason();

  const { count: excludedOutOfScope } = await args.admin
    .from("project_knowledge_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", args.projectId)
    .eq("source_type", "clickup_doc")
    .in("sync_status", ["out_of_scope", "unknown_scope", "archived", "deleted"]);

  const { count: activeClickupDocs } = await args.admin
    .from("project_knowledge_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", args.projectId)
    .eq("source_type", "clickup_doc")
    .eq("sync_status", "active");

  const activeSourceIds = await loadActiveKnowledgeSourceIds(args.admin, args.projectId);

  const countClickupDocChunks = (chunks: RetrievalChunk[]) =>
    chunks.filter(
      (c) =>
        c.category === "clickup_doc" ||
        c.metadata?.source_type === "clickup_doc",
    ).length;

  const filterActive = (chunks: RetrievalChunk[]) =>
    chunks.filter((c) => !c.source_id || activeSourceIds.has(c.source_id));

  try {
    if (embeddingsEnabled) {
      const embedding = await embedQuery(args.queryText);
      if (embedding) {
        const { data, error } = await args.admin.rpc("match_project_knowledge_chunks", {
          p_project_id: args.projectId,
          p_query_embedding: embedding,
          p_match_count: matchCount,
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          const chunks = filterActive(
            data.map((row: Record<string, unknown>) => ({
              id: String(row.id),
              source_id: row.source_id ? String(row.source_id) : null,
              content: String(row.content ?? ""),
              metadata: (row.metadata ?? {}) as Record<string, unknown>,
              category: typeof row.category === "string" ? row.category : null,
              similarity: typeof row.similarity === "number" ? row.similarity : undefined,
            })),
          );
          return {
            mode: "vector",
            chunks,
            clickup_doc_chunks_retrieved: countClickupDocChunks(chunks),
            active_clickup_doc_sources: activeClickupDocs ?? 0,
            excluded_out_of_scope_sources: excludedOutOfScope ?? 0,
            embeddings_enabled: true,
            embedding_provider: embedCfg.provider,
          };
        }
      }
    }
  } catch (e) {
    console.warn("[retrieval] vector search failed, using fallback:", (e as Error).message);
  }

  const activeIds = [...activeSourceIds];
  const fallbackQuery = args.admin
    .from("project_knowledge_chunks")
    .select("id, source_id, content, metadata, category, created_at")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(matchCount * 3);
  const { data: fallbackRows } = activeIds.length > 0
    ? await fallbackQuery.in("source_id", activeIds)
    : await fallbackQuery;

  const queryTokens = args.queryText.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const scored = (fallbackRows ?? [])
    .filter((row) => !row.source_id || activeSourceIds.has(String(row.source_id)))
    .map((row) => {
    const content = String(row.content ?? "").toLowerCase();
    const score = queryTokens.reduce((acc, token) => acc + (content.includes(token) ? 1 : 0), 0);
      return { row, score };
    });
  scored.sort((a, b) => b.score - a.score);

  const chunks = scored.slice(0, matchCount).map(({ row }) => ({
    id: String(row.id),
    source_id: row.source_id ? String(row.source_id) : null,
    content: String(row.content ?? ""),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    category: typeof row.category === "string" ? row.category : null,
  }));

  return {
    mode: "fallback",
    chunks,
    clickup_doc_chunks_retrieved: countClickupDocChunks(chunks),
    active_clickup_doc_sources: activeClickupDocs ?? 0,
    excluded_out_of_scope_sources: excludedOutOfScope ?? 0,
    embeddings_enabled: embeddingsEnabled,
    embedding_provider: embedCfg.provider,
    embedding_skip_reason: embeddingSkipReason,
  };
}

export async function embedProjectKnowledgeChunks(args: {
  admin: SupabaseClient;
  projectId: string;
  sourceId?: string;
  force?: boolean;
  batchSize?: number;
}): Promise<EmbedProjectKnowledgeResult> {
  if (!isEmbeddingsEnabled()) {
    return {
      embedded_count: 0,
      skipped_count: 0,
      model: "",
      embedding_enabled: false,
      embedding_skipped: true,
      reason: embeddingsDisabledReason(),
      retrieval_mode: "fallback",
    };
  }
  const { model } = embeddingConfig();
  const batchSize = args.batchSize ?? DEFAULT_BATCH;
  const activeSourceIds = await loadActiveKnowledgeSourceIds(args.admin, args.projectId);

  let query = args.admin
    .from("project_knowledge_chunks")
    .select("id, content, source_id")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: true });

  if (args.sourceId) query = query.eq("source_id", args.sourceId);
  if (!args.force) query = query.is("embedding", null);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const eligible = (rows ?? []).filter(
    (r) =>
      String(r.content ?? "").trim().length >= MIN_CHUNK_CHARS &&
      (!r.source_id || activeSourceIds.has(String(r.source_id))),
  );
  let embedded = 0;
  let skipped = (rows ?? []).length - eligible.length;

  for (let i = 0; i < eligible.length; i += batchSize) {
    const batch = eligible.slice(i, i + batchSize);
    const vectors = await embedTexts(batch.map((r) => String(r.content)));
    for (let j = 0; j < batch.length; j += 1) {
      const vector = vectors[j];
      if (!vector) continue;
      const { error: upErr } = await args.admin
        .from("project_knowledge_chunks")
        .update({
          embedding: vector,
          embedding_model: model,
          embedded_at: new Date().toISOString(),
        })
        .eq("id", batch[j].id);
      if (upErr) throw new Error(upErr.message);
      embedded += 1;
    }
  }

  return {
    embedded_count: embedded,
    skipped_count: skipped,
    model,
    embedding_enabled: true,
    embedding_skipped: false,
    retrieval_mode: "vector",
  };
}
