import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_BATCH,
  embeddingsDisabledReason,
  embedQuery,
  embedTexts,
  embeddingConfig,
  isEmbeddingsEnabled,
  MIN_CHUNK_CHARS,
} from "./embeddings.ts";
import { contextualizeKnowledgeChunk } from "../knowledgeChunking.ts";
import { loadActiveKnowledgeSourceIds } from "../knowledgeSourceScope.ts";
import type { RetrievalChunk } from "./types.ts";
import {
  deletePineconeNamespace,
  deletePineconeSource,
  deletePineconeSourceVersionsBefore,
  generatePineconeSparseVectors,
  isPineconeConfigured,
  pineconeConfig,
  pineconeNamespace,
  pineconeVectorId,
  queryPinecone,
  rerankPinecone,
  upsertPineconeVectors,
  type PineconeMatch,
} from "./pinecone.ts";

export type EmbedProjectKnowledgeResult = {
  embedded_count: number;
  skipped_count: number;
  model: string;
  embedding_enabled: boolean;
  embedding_skipped?: boolean;
  reason?: string;
  retrieval_mode: "pinecone_hybrid" | "vector" | "fallback";
  pinecone_sync?: PineconeSyncResult;
};

export type PineconeSyncResult = {
  configured: boolean;
  status: "not_configured" | "ready" | "degraded";
  indexed_count: number;
  deleted_source_count?: number;
  index_name: string;
  namespace: string;
  error?: string;
};

export type ProjectKnowledgeRetrievalResult = {
  chunks: RetrievalChunk[];
  mode: "pinecone_hybrid" | "vector" | "fallback";
  clickup_doc_chunks_retrieved: number;
  active_clickup_doc_sources: number;
  excluded_out_of_scope_sources: number;
  embeddings_enabled: boolean;
  embedding_provider: string;
  embedding_skip_reason?: string;
  pinecone_configured: boolean;
  pinecone_used: boolean;
  pinecone_queried: boolean;
  pinecone_matches: number;
  pinecone_candidates: number;
  pinecone_reranked: number;
  pinecone_mode: "off" | "shadow" | "primary";
  pinecone_shadow_overlap?: number;
  pinecone_error?: string;
  pinecone_index?: string;
  pinecone_namespace?: string;
  retrieval_query: string;
};

const OPERATIONAL_SOURCE_TYPES = [
  "clickup",
  "clickup_doc",
  "slack",
  "slack_summary",
  "client_feedback",
  "delivery_update",
  "meeting_transcript",
  "zoom_transcript",
  "agent",
];

function retrievalChunk(row: Record<string, unknown>): RetrievalChunk {
  return {
    id: String(row.id),
    source_id: row.source_id ? String(row.source_id) : null,
    content: String(row.content ?? ""),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    category: typeof row.category === "string" ? row.category : null,
    similarity: typeof row.similarity === "number" ? row.similarity : undefined,
  };
}

function parseStoredVector(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) return value as number[];
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "number") ? parsed : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isTemporalKnowledgeQuery(query: string): boolean {
  return /\b(current|latest|recent|today|this week|next meeting|changed|blocker|risk|progress|priority|status|attention|update|yesterday|tomorrow)\b/i
    .test(query);
}

/** Add only the minimum conversation needed to resolve short follow-ups. */
export function buildHistoryAwareRetrievalQuery(
  currentMessage: string,
  history: Array<{ role: string; content: string }> = [],
): string {
  const query = currentMessage.trim();
  if (!query || history.length === 0) return query;
  const needsContext = query.length < 90 || /\b(it|that|those|they|them|this|these|he|she|there|same|above|former|latter)\b/i.test(query);
  if (!needsContext) return query;
  const context = history
    .slice(-4)
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").trim().slice(0, 700)}`)
    .join("\n");
  return `Conversation context:\n${context}\n\nCurrent question:\n${query}`.slice(-3_800);
}

async function updatePineconeSyncState(
  admin: SupabaseClient,
  projectId: string,
  patch: Record<string, unknown>,
) {
  const config = pineconeConfig();
  const { error } = await admin.from("project_chat_vector_sync").upsert({
    project_id: projectId,
    provider: "pinecone",
    index_name: config.indexName,
    namespace: pineconeNamespace(projectId),
    updated_at: new Date().toISOString(),
    ...patch,
  }, { onConflict: "project_id" });
  if (error) console.warn("[pinecone] Could not update sync state:", error.message);
}

async function retrieveFromSupabase(args: {
  admin: SupabaseClient;
  projectId: string;
  queryText: string;
  embedding: number[];
  matchCount: number;
  activeSourceIds: Set<string>;
}): Promise<RetrievalChunk[]> {
  const { data, error } = await args.admin.rpc("hybrid_match_project_knowledge_chunks", {
    p_project_id: args.projectId,
    p_query_text: args.queryText,
    p_query_embedding: args.embedding,
    p_match_count: args.matchCount,
  });
  if (error || !Array.isArray(data)) return [];
  return data
    .map((row: Record<string, unknown>) => retrievalChunk(row))
    .filter((chunk: RetrievalChunk) => !chunk.source_id || args.activeSourceIds.has(chunk.source_id));
}

type PineconeCandidate = {
  pineconeId: string;
  chunk: RetrievalChunk;
  retrievalScore: number;
};

function candidateFromMatch(match: PineconeMatch): PineconeCandidate {
  const metadata = match.metadata ?? {};
  const chunkId = asString(metadata.chunk_id) ?? match.id;
  return {
    pineconeId: match.id,
    retrievalScore: match.score,
    chunk: {
      id: chunkId,
      source_id: asString(metadata.source_id),
      content: asString(metadata.chunk_text) ?? "",
      category: asString(metadata.category) ?? asString(metadata.source_type),
      similarity: match.score,
      metadata: { ...metadata, pinecone_id: match.id, retrieval_score: match.score },
    },
  };
}

async function hydrateLegacyPineconeCandidates(
  admin: SupabaseClient,
  projectId: string,
  candidates: PineconeCandidate[],
): Promise<PineconeCandidate[]> {
  const ids = [...new Set(candidates.flatMap((candidate) => {
    if (candidate.chunk.content) return [];
    const metadataId = asString(candidate.chunk.metadata.chunk_id);
    const id = metadataId ?? (isUuid(candidate.pineconeId) ? candidate.pineconeId : null);
    return id ? [id] : [];
  }))];
  if (ids.length === 0) return candidates.filter((candidate) => candidate.chunk.content);

  const { data } = await admin
    .from("project_knowledge_chunks")
    .select("id, source_id, content, metadata, category")
    .eq("project_id", projectId)
    .in("id", ids);
  const rows = new Map<string, Record<string, unknown>>(
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]),
  );
  return candidates.flatMap((candidate) => {
    if (candidate.chunk.content) return [candidate];
    const lookupId = asString(candidate.chunk.metadata.chunk_id) ?? candidate.pineconeId;
    const row = rows.get(lookupId);
    if (!row) return [];
    return [{
      ...candidate,
      chunk: {
        ...retrievalChunk(row),
        similarity: candidate.chunk.similarity,
        metadata: { ...((row.metadata ?? {}) as Record<string, unknown>), ...candidate.chunk.metadata },
      },
    }];
  });
}

function diversifyBySource(candidates: PineconeCandidate[], wanted: number): PineconeCandidate[] {
  const sourceCounts = new Map<string, number>();
  const selected: PineconeCandidate[] = [];
  for (const candidate of candidates) {
    const sourceKey = candidate.chunk.source_id ?? candidate.chunk.id;
    const count = sourceCounts.get(sourceKey) ?? 0;
    if (count >= 2) continue;
    selected.push(candidate);
    sourceCounts.set(sourceKey, count + 1);
    if (selected.length >= wanted) break;
  }
  return selected;
}

async function addNeighborContext(
  admin: SupabaseClient,
  projectId: string,
  candidates: PineconeCandidate[],
): Promise<PineconeCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    const sourceId = candidate.chunk.source_id;
    const chunkIndex = asNumber(candidate.chunk.metadata.chunk_index, -1);
    if (!sourceId || chunkIndex < 0) return candidate;
    const wanted = [...new Set([chunkIndex - 1, chunkIndex, chunkIndex + 1].filter((value) => value >= 0))];
    const { data } = await admin
      .from("project_knowledge_chunks")
      .select("id, chunk_index, content")
      .eq("project_id", projectId)
      .eq("source_id", sourceId)
      .in("chunk_index", wanted)
      .order("chunk_index", { ascending: true });
    if (!data || data.length <= 1) return candidate;
    const neighborRows = data as Array<Record<string, unknown>>;
    const expanded = neighborRows.map((row) => String(row.content ?? "").trim()).filter(Boolean).join("\n\n").slice(0, 6_000);
    return {
      ...candidate,
      chunk: {
        ...candidate.chunk,
        content: expanded || candidate.chunk.content,
        metadata: {
          ...candidate.chunk.metadata,
          neighbor_chunk_ids: neighborRows.map((row) => String(row.id)),
        },
      },
    };
  }));
}

async function retrieveFromPinecone(args: {
  admin: SupabaseClient;
  projectId: string;
  queryText: string;
  embedding: number[];
  matchCount: number;
  activeSourceIds: Set<string>;
}): Promise<{ chunks: RetrievalChunk[]; candidates: number; reranked: number }> {
  const [sparseVector] = await generatePineconeSparseVectors([args.queryText], "query")
    .catch((error) => {
      console.warn("[pinecone] Sparse query embedding failed; continuing dense-only:", (error as Error).message);
      return [null];
    });
  const globalQuery = queryPinecone({
    projectId: args.projectId,
    vector: args.embedding,
    sparseVector,
    topK: Math.max(40, args.matchCount * 5),
    filter: { status: { $eq: "active" } },
  });
  const temporalQuery = isTemporalKnowledgeQuery(args.queryText)
    ? queryPinecone({
        projectId: args.projectId,
        vector: args.embedding,
        sparseVector,
        topK: Math.max(25, args.matchCount * 4),
        filter: {
          $and: [
            { status: { $eq: "active" } },
            { source_type: { $in: OPERATIONAL_SOURCE_TYPES } },
          ],
        },
      })
    : Promise.resolve([] as PineconeMatch[]);
  const [globalMatches, temporalMatches] = await Promise.all([globalQuery, temporalQuery]);

  const fused = new Map<string, { match: PineconeMatch; score: number }>();
  const addRanked = (matches: PineconeMatch[], weight: number) => matches.forEach((match, index) => {
    const previous = fused.get(match.id);
    fused.set(match.id, {
      match: previous?.match ?? match,
      score: (previous?.score ?? 0) + weight / (60 + index + 1),
    });
  });
  addRanked(globalMatches, 1);
  addRanked(temporalMatches, 1.2);
  let candidates = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...candidateFromMatch(entry.match), retrievalScore: entry.score }));
  candidates = await hydrateLegacyPineconeCandidates(args.admin, args.projectId, candidates);
  candidates = candidates.filter((candidate) =>
    candidate.chunk.content &&
    (!candidate.chunk.source_id || args.activeSourceIds.has(candidate.chunk.source_id))
  );

  let ranked = candidates;
  let rerankedCount = 0;
  try {
    const reranked = await rerankPinecone({
      query: args.queryText,
      documents: candidates.slice(0, 60).map((candidate) => ({ id: candidate.pineconeId, text: candidate.chunk.content })),
      topN: Math.min(Math.max(args.matchCount * 2, 12), candidates.length),
    });
    if (reranked.length > 0) {
      const rerankMap = new Map(reranked.map((row, index) => [row.id, { score: row.score, index }]));
      ranked = candidates
        .filter((candidate) => rerankMap.has(candidate.pineconeId))
        .map((candidate) => ({
          ...candidate,
          chunk: {
            ...candidate.chunk,
            similarity: rerankMap.get(candidate.pineconeId)!.score,
            metadata: {
              ...candidate.chunk.metadata,
              rerank_score: rerankMap.get(candidate.pineconeId)!.score,
            },
          },
        }))
        .sort((a, b) => rerankMap.get(a.pineconeId)!.index - rerankMap.get(b.pineconeId)!.index);
      rerankedCount = ranked.length;
    }
  } catch (error) {
    console.warn("[pinecone] Rerank failed; using hybrid retrieval order:", (error as Error).message);
  }

  const diverse = diversifyBySource(ranked, args.matchCount);
  const expanded = await addNeighborContext(args.admin, args.projectId, diverse);
  return {
    chunks: expanded.map((candidate, index) => ({
      ...candidate.chunk,
      metadata: { ...candidate.chunk.metadata, citation_id: `S${index + 1}` },
    })),
    candidates: candidates.length,
    reranked: rerankedCount,
  };
}

export async function retrieveProjectKnowledge(args: {
  admin: SupabaseClient;
  projectId: string;
  queryText: string;
  matchCount?: number;
  usePinecone?: boolean;
}): Promise<ProjectKnowledgeRetrievalResult> {
  const matchCount = args.matchCount ?? 10;
  const queryText = args.queryText.trim();
  const embedCfg = embeddingConfig();
  const embeddingsEnabled = isEmbeddingsEnabled();
  const embeddingSkipReason = embeddingsEnabled ? undefined : embeddingsDisabledReason();
  const config = pineconeConfig();
  const pineconeEnabled = args.usePinecone === true && isPineconeConfigured() && config.retrievalMode !== "off";
  const namespace = pineconeNamespace(args.projectId);
  let pineconeError: string | undefined;
  let pineconeCandidates = 0;
  let pineconeReranked = 0;
  let pineconeQueried = false;
  let shadowOverlap: number | undefined;

  const [{ count: excludedOutOfScope }, { count: activeClickupDocs }, activeSourceIds] = await Promise.all([
    args.admin
      .from("project_knowledge_sources")
      .select("id", { count: "exact", head: true })
      .eq("project_id", args.projectId)
      .eq("source_type", "clickup_doc")
      .in("sync_status", ["out_of_scope", "unknown_scope", "archived", "deleted"]),
    args.admin
      .from("project_knowledge_sources")
      .select("id", { count: "exact", head: true })
      .eq("project_id", args.projectId)
      .eq("source_type", "clickup_doc")
      .eq("sync_status", "active"),
    loadActiveKnowledgeSourceIds(args.admin, args.projectId),
  ]);

  const countClickupDocChunks = (chunks: RetrievalChunk[]) => chunks.filter((chunk) =>
    chunk.category === "clickup_doc" || chunk.metadata?.source_type === "clickup_doc"
  ).length;

  const response = (chunks: RetrievalChunk[], mode: ProjectKnowledgeRetrievalResult["mode"], pineconeUsed: boolean): ProjectKnowledgeRetrievalResult => ({
    mode,
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      metadata: { ...chunk.metadata, citation_id: chunk.metadata.citation_id ?? `S${index + 1}` },
    })),
    clickup_doc_chunks_retrieved: countClickupDocChunks(chunks),
    active_clickup_doc_sources: activeClickupDocs ?? 0,
    excluded_out_of_scope_sources: excludedOutOfScope ?? 0,
    embeddings_enabled: embeddingsEnabled,
    embedding_provider: embedCfg.provider,
    embedding_skip_reason: embeddingSkipReason,
    pinecone_configured: pineconeEnabled,
    pinecone_used: pineconeUsed,
    pinecone_queried: pineconeQueried,
    pinecone_matches: pineconeUsed ? chunks.length : 0,
    pinecone_candidates: pineconeCandidates,
    pinecone_reranked: pineconeReranked,
    pinecone_mode: config.retrievalMode,
    pinecone_shadow_overlap: shadowOverlap,
    pinecone_error: pineconeError,
    pinecone_index: pineconeEnabled ? config.indexName : undefined,
    pinecone_namespace: pineconeEnabled ? namespace : undefined,
    retrieval_query: queryText,
  });

  try {
    if (embeddingsEnabled && queryText) {
      const embedding = await embedQuery(queryText);
      if (embedding) {
        if (pineconeEnabled && config.retrievalMode === "primary") {
          pineconeQueried = true;
          try {
            const pinecone = await retrieveFromPinecone({
              admin: args.admin,
              projectId: args.projectId,
              queryText,
              embedding,
              matchCount,
              activeSourceIds,
            });
            pineconeCandidates = pinecone.candidates;
            pineconeReranked = pinecone.reranked;
            await updatePineconeSyncState(args.admin, args.projectId, {
              status: "ready",
              last_queried_at: new Date().toISOString(),
              last_verified_at: new Date().toISOString(),
              last_error: null,
              metadata: { retrieval_mode: "primary", candidates: pinecone.candidates, reranked: pinecone.reranked },
            });
            if (pinecone.chunks.length > 0) return response(pinecone.chunks, "pinecone_hybrid", true);
          } catch (error) {
            pineconeError = (error as Error).message;
            await updatePineconeSyncState(args.admin, args.projectId, {
              status: "degraded",
              last_queried_at: new Date().toISOString(),
              last_verified_at: new Date().toISOString(),
              last_error: pineconeError.slice(0, 1000),
            });
          }
          const fallback = await retrieveFromSupabase({
            admin: args.admin,
            projectId: args.projectId,
            queryText,
            embedding,
            matchCount,
            activeSourceIds,
          });
          if (fallback.length > 0) return response(fallback, "vector", false);
        } else {
          const supabasePromise = retrieveFromSupabase({
            admin: args.admin,
            projectId: args.projectId,
            queryText,
            embedding,
            matchCount,
            activeSourceIds,
          });
          const pineconePromise = pineconeEnabled
            ? (async () => {
                pineconeQueried = true;
                try {
                  return await retrieveFromPinecone({
                    admin: args.admin,
                    projectId: args.projectId,
                    queryText,
                    embedding,
                    matchCount,
                    activeSourceIds,
                  });
                } catch (error) {
                  pineconeError = (error as Error).message;
                  return { chunks: [] as RetrievalChunk[], candidates: 0, reranked: 0 };
                }
              })()
            : Promise.resolve({ chunks: [] as RetrievalChunk[], candidates: 0, reranked: 0 });
          const [supabaseChunks, pinecone] = await Promise.all([supabasePromise, pineconePromise]);
          pineconeCandidates = pinecone.candidates;
          pineconeReranked = pinecone.reranked;
          if (pineconeEnabled) {
            const supabaseIds = new Set(supabaseChunks.map((chunk) => chunk.id));
            shadowOverlap = pinecone.chunks.filter((chunk) => supabaseIds.has(chunk.id)).length;
            await updatePineconeSyncState(args.admin, args.projectId, {
              status: pineconeError ? "degraded" : "ready",
              last_queried_at: new Date().toISOString(),
              last_verified_at: new Date().toISOString(),
              last_error: pineconeError?.slice(0, 1000) ?? null,
              metadata: {
                retrieval_mode: "shadow",
                candidates: pinecone.candidates,
                reranked: pinecone.reranked,
                result_overlap: shadowOverlap,
              },
            });
          }
          if (supabaseChunks.length > 0) return response(supabaseChunks, "vector", false);
          if (pinecone.chunks.length > 0) return response(pinecone.chunks, "pinecone_hybrid", true);
        }
      }
    }
  } catch (error) {
    console.warn("[retrieval] Vector search failed, using lexical fallback:", (error as Error).message);
  }

  const activeIds = [...activeSourceIds];
  const fallbackQuery = args.admin
    .from("project_knowledge_chunks")
    .select("id, source_id, content, metadata, category, created_at")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(matchCount * 4);
  const { data: fallbackRows } = activeIds.length > 0
    ? await fallbackQuery.in("source_id", activeIds)
    : await fallbackQuery;
  const queryTokens = queryText.toLowerCase().split(/\W+/).filter((token) => token.length > 3);
  const chunks = ((fallbackRows ?? []) as Array<Record<string, unknown>>)
    .filter((row) => !row.source_id || activeSourceIds.has(String(row.source_id)))
    .map((row) => {
      const content = String(row.content ?? "").toLowerCase();
      return { row, score: queryTokens.reduce((score, token) => score + (content.includes(token) ? 1 : 0), 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, matchCount)
    .map(({ row }) => retrievalChunk(row as Record<string, unknown>));
  return response(chunks, "fallback", false);
}

function metadataString(value: unknown, max = 1_000): string {
  return asString(value)?.slice(0, max) ?? "";
}

export async function syncProjectKnowledgeToPinecone(args: {
  admin: SupabaseClient;
  projectId: string;
  sourceId?: string;
}): Promise<PineconeSyncResult> {
  const config = pineconeConfig();
  const namespace = pineconeNamespace(args.projectId);
  const syncStartedAt = new Date().toISOString();
  if (!isPineconeConfigured()) {
    return { configured: false, status: "not_configured", indexed_count: 0, index_name: config.indexName, namespace };
  }

  await updatePineconeSyncState(args.admin, args.projectId, { status: "syncing", last_error: null });
  try {
    const { data: sourceRows, error: sourceError } = await args.admin
      .from("project_knowledge_sources")
      .select("id, source_title, source_type, sync_status, created_at, last_synced_at, metadata, content_version")
      .eq("project_id", args.projectId);
    if (sourceError) throw new Error(sourceError.message);
    const sources = (sourceRows ?? []) as Array<Record<string, unknown>>;
  const sourceMap = new Map<string, Record<string, unknown>>(sources.map((source) => [String(source.id), source]));
    const activeSourceIds = new Set(sources
      .filter((source) => String(source.sync_status ?? "active") === "active")
      .map((source) => String(source.id)));

    const staleSources = sources.filter((source) =>
      String(source.sync_status ?? "active") !== "active" && (!args.sourceId || String(source.id) === args.sourceId)
    );
    for (const source of staleSources) await deletePineconeSource(args.projectId, String(source.id));

    let query = args.admin
      .from("project_knowledge_chunks")
      .select("id, source_id, embedding, embedding_model, category, created_at, chunk_index, content, metadata, content_version, content_hash, section_path")
      .eq("project_id", args.projectId)
      .not("embedding", "is", null)
      .order("created_at", { ascending: true });
    if (args.sourceId) query = query.eq("source_id", args.sourceId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const eligible = ((rows ?? []) as Array<Record<string, unknown>>)
      .filter((row) => row.source_id && activeSourceIds.has(String(row.source_id)));

    if (args.sourceId) await deletePineconeSource(args.projectId, args.sourceId);
    let indexedCount = 0;
    const indexedSourceIds = new Set<string>();
    const indexedSourceVersions = new Map<string, number>();
    for (let index = 0; index < eligible.length; index += 64) {
      const batch = eligible.slice(index, index + 64);
      const prepared = batch.flatMap((row) => {
        const values = parseStoredVector(row.embedding);
        const source = sourceMap.get(String(row.source_id));
        if (!values || values.length !== config.dimension || !source) return [];
        const sourceMetadata = (source.metadata ?? {}) as Record<string, unknown>;
        const chunkMetadata = (row.metadata ?? {}) as Record<string, unknown>;
        const sourceTitle = metadataString(source.source_title, 500) || "Untitled source";
        const sourceType = metadataString(source.source_type, 100) || "unknown";
        const sectionPath = metadataString(row.section_path ?? chunkMetadata.section_path, 500);
        const chunkText = contextualizeKnowledgeChunk({
          content: String(row.content ?? ""),
          title: sourceTitle,
          sectionPath,
          sourceType,
        }).slice(0, 12_000);
        const contentVersion = asNumber(row.content_version ?? source.content_version, 1);
        const chunkIndex = asNumber(row.chunk_index, 0);
        return [{ row, source, sourceMetadata, values, sourceTitle, sourceType, sectionPath, chunkText, contentVersion, chunkIndex }];
      });
      const sparseVectors = await generatePineconeSparseVectors(prepared.map((item) => item.chunkText), "passage")
        .catch((sparseError) => {
          console.warn("[pinecone] Sparse passage embedding failed; storing dense-only batch:", (sparseError as Error).message);
          return prepared.map(() => null);
        });
      const vectors = prepared.map((item, itemIndex) => {
        const sourceUpdated = metadataString(item.source.last_synced_at ?? item.source.created_at, 80);
        const sourceUrl = metadataString(
          item.sourceMetadata.source_url ?? item.sourceMetadata.url ?? item.sourceMetadata.canonical_url,
          1_000,
        );
        indexedSourceIds.add(String(item.row.source_id));
        indexedSourceVersions.set(String(item.row.source_id), item.contentVersion);
        return {
          id: pineconeVectorId(String(item.row.source_id), item.contentVersion, item.chunkIndex),
          values: item.values,
          ...(sparseVectors[itemIndex] ? { sparseValues: sparseVectors[itemIndex]! } : {}),
          metadata: {
            project_id: args.projectId,
            chunk_id: String(item.row.id),
            source_id: String(item.row.source_id),
            document_id: String(item.row.source_id),
            source_type: item.sourceType,
            source_title: item.sourceTitle,
            category: metadataString(item.row.category, 100) || item.sourceType,
            section_path: item.sectionPath,
            chunk_index: item.chunkIndex,
            chunk_text: item.chunkText,
            status: "active",
            authority: metadataString(item.sourceMetadata.authority, 100) || "project_source",
            source_updated_at: sourceUpdated,
            source_updated_ts: sourceUpdated ? Math.floor(new Date(sourceUpdated).getTime() / 1_000) || 0 : 0,
            content_version: item.contentVersion,
            content_hash: metadataString(item.row.content_hash ?? item.sourceMetadata.content_hash, 100),
            canonical_url: sourceUrl,
            language: metadataString(item.sourceMetadata.language, 50),
            embedding_model: metadataString(item.row.embedding_model, 200),
          },
        };
      });
      const result = await upsertPineconeVectors({ projectId: args.projectId, vectors });
      indexedCount += result.upsertedCount;
    }

    if (!args.sourceId) {
      for (const [sourceId, version] of indexedSourceVersions) {
        await deletePineconeSourceVersionsBefore(args.projectId, sourceId, version);
      }
    }

    const now = new Date().toISOString();
    if (indexedSourceIds.size > 0) {
      await args.admin
        .from("project_knowledge_sources")
        .update({ index_status: "indexed", indexed_at: now, index_error: null })
        .in("id", [...indexedSourceIds]);
    }
    await updatePineconeSyncState(args.admin, args.projectId, {
      status: "ready",
      vector_count: eligible.length,
      last_indexed_at: now,
      last_verified_at: now,
      last_error: null,
      metadata: {
        retrieval_mode: config.retrievalMode,
        hybrid_enabled: config.hybridEnabled,
        sparse_model: config.sparseModel,
        rerank_model: config.rerankEnabled ? config.rerankModel : null,
      },
    });
    let completedJobs = args.admin
      .from("project_knowledge_index_jobs")
      .update({ status: "completed", completed_at: now, last_error: null })
      .eq("project_id", args.projectId)
      .in("status", ["pending", "running"])
      .in("action", ["upsert_project", "upsert_source", "delete_source"])
      .lte("updated_at", syncStartedAt);
    if (args.sourceId) completedJobs = completedJobs.eq("source_id", args.sourceId);
    const { error: completedJobsError } = await completedJobs;
    if (completedJobsError) console.warn("[pinecone] Could not complete outbox rows:", completedJobsError.message);
    return {
      configured: true,
      status: "ready",
      indexed_count: indexedCount,
      deleted_source_count: staleSources.length,
      index_name: config.indexName,
      namespace,
    };
  } catch (error) {
    const message = (error as Error).message;
    if (args.sourceId) {
      await args.admin
        .from("project_knowledge_sources")
        .update({ index_status: "failed", index_error: message.slice(0, 1000) })
        .eq("id", args.sourceId);
    }
    await updatePineconeSyncState(args.admin, args.projectId, {
      status: "degraded",
      last_verified_at: new Date().toISOString(),
      last_error: message.slice(0, 1000),
    });
    return { configured: true, status: "degraded", indexed_count: 0, index_name: config.indexName, namespace, error: message };
  }
}

export async function embedProjectKnowledgeChunks(args: {
  admin: SupabaseClient;
  projectId: string;
  sourceId?: string;
  force?: boolean;
  batchSize?: number;
  syncPinecone?: boolean;
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
    .select("id, content, source_id, metadata, section_path")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: true });
  if (args.sourceId) query = query.eq("source_id", args.sourceId);
  if (!args.force) query = query.is("embedding", null);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const chunkRows = (rows ?? []) as Array<Record<string, unknown>>;
  const eligible = chunkRows.filter((row) =>
    String(row.content ?? "").trim().length >= MIN_CHUNK_CHARS &&
    (!row.source_id || activeSourceIds.has(String(row.source_id)))
  );
  const sourceIds = [...new Set(eligible.flatMap((row) => row.source_id ? [String(row.source_id)] : []))];
  const { data: sources } = sourceIds.length > 0
    ? await args.admin.from("project_knowledge_sources").select("id, source_title, source_type").in("id", sourceIds)
    : { data: [] as Array<Record<string, unknown>> };
  const sourceMap = new Map<string, Record<string, unknown>>(
    ((sources ?? []) as Array<Record<string, unknown>>).map((source) => [String(source.id), source]),
  );

  let embedded = 0;
  const skipped = chunkRows.length - eligible.length;
  for (let i = 0; i < eligible.length; i += batchSize) {
    const batch = eligible.slice(i, i + batchSize);
    const inputs = batch.map((row) => {
      const source = row.source_id ? sourceMap.get(String(row.source_id)) : undefined;
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return contextualizeKnowledgeChunk({
        content: String(row.content),
        title: asString(source?.source_title),
        sourceType: asString(source?.source_type),
        sectionPath: asString(row.section_path ?? metadata.section_path),
      });
    });
    const vectors = await embedTexts(inputs);
    for (let j = 0; j < batch.length; j += 1) {
      const vector = vectors[j];
      if (!vector) continue;
      const { error: updateError } = await args.admin
        .from("project_knowledge_chunks")
        .update({ embedding: vector, embedding_model: model, embedded_at: new Date().toISOString() })
        .eq("id", batch[j].id);
      if (updateError) throw new Error(updateError.message);
      embedded += 1;
    }
  }

  const pineconeSync = args.syncPinecone
    ? await syncProjectKnowledgeToPinecone({ admin: args.admin, projectId: args.projectId, sourceId: args.sourceId })
    : undefined;
  return {
    embedded_count: embedded,
    skipped_count: skipped,
    model,
    embedding_enabled: true,
    embedding_skipped: false,
    retrieval_mode: pineconeSync?.status === "ready" ? "pinecone_hybrid" : "vector",
    pinecone_sync: pineconeSync,
  };
}

export async function processPineconeIndexJobs(args: {
  admin: SupabaseClient;
  projectId?: string;
  limit?: number;
}): Promise<{ processed: number; failed: number }> {
  const { data, error } = await args.admin.rpc("claim_project_knowledge_index_jobs", {
    p_limit: Math.max(1, Math.min(args.limit ?? 10, 50)),
    p_project_id: args.projectId ?? null,
  });
  if (error) throw new Error(error.message);
  let processed = 0;
  let failed = 0;
  for (const job of (data ?? []) as Array<Record<string, unknown>>) {
    const jobId = String(job.id);
    const projectId = String(job.project_id);
    const sourceId = asString(job.source_id);
    const action = String(job.action);
    try {
      if (action === "delete_namespace") await deletePineconeNamespace(projectId);
      else if (action === "delete_source" && sourceId) await deletePineconeSource(projectId, sourceId);
      else {
        const result = await embedProjectKnowledgeChunks({
          admin: args.admin,
          projectId,
          sourceId: action === "upsert_source" ? sourceId ?? undefined : undefined,
          syncPinecone: true,
        });
        if (result.embedding_skipped) throw new Error(result.reason ?? "Embeddings are disabled.");
        if (result.pinecone_sync?.status === "degraded") {
          throw new Error(result.pinecone_sync.error ?? "Pinecone sync is degraded.");
        }
      }
      await args.admin
        .from("project_knowledge_index_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString(), last_error: null })
        .eq("id", jobId);
      processed += 1;
    } catch (jobError) {
      const attempts = asNumber(job.attempts, 1);
      await args.admin
        .from("project_knowledge_index_jobs")
        .update({
          status: attempts >= 5 ? "failed" : "pending",
          available_at: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1_000)).toISOString(),
          last_error: (jobError as Error).message.slice(0, 1000),
        })
        .eq("id", jobId);
      failed += 1;
    }
  }
  return { processed, failed };
}
