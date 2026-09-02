const CONTROL_PLANE_URL = "https://api.pinecone.io";
const DEFAULT_INDEX_NAME = "oxus-project-knowledge-v2";
const DEFAULT_API_VERSION = "2026-04";
const CONTROL_TIMEOUT_MS = 10_000;
const INGEST_TIMEOUT_MS = 20_000;
const QUERY_TIMEOUT_MS = 3_500;
const HOST_CACHE_MS = 5 * 60_000;

export type PineconeRetrievalMode = "off" | "shadow" | "primary";

export type PineconeIndexDescription = {
  name: string;
  host: string;
  dimension: number;
  metric: string;
  status?: { ready?: boolean; state?: string };
};

export type PineconeMatch = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export type PineconeSparseVector = {
  indices: number[];
  values: number[];
};

export type PineconeVector = {
  id: string;
  values: number[];
  sparseValues?: PineconeSparseVector;
  metadata?: Record<string, string | number | boolean | string[]>;
};

export type PineconeRerankDocument = {
  id: string;
  text: string;
};

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name)?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(Deno.env.get(name));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function pineconeConfig() {
  const requestedMode = Deno.env.get("PINECONE_RETRIEVAL_MODE")?.trim().toLowerCase() || "shadow";
  const retrievalMode: PineconeRetrievalMode = requestedMode === "primary" || requestedMode === "off"
    ? requestedMode
    : "shadow";
  return {
    apiKey: Deno.env.get("PINECONE_API_KEY")?.trim() ?? "",
    indexName: Deno.env.get("PINECONE_INDEX_NAME")?.trim() || DEFAULT_INDEX_NAME,
    indexHost: Deno.env.get("PINECONE_INDEX_HOST")?.trim() || "",
    apiVersion: Deno.env.get("PINECONE_API_VERSION")?.trim() || DEFAULT_API_VERSION,
    cloud: Deno.env.get("PINECONE_CLOUD")?.trim() || "aws",
    region: Deno.env.get("PINECONE_REGION")?.trim() || "us-east-1",
    dimension: Number(Deno.env.get("EMBEDDING_DIMENSIONS") ?? "1536"),
    hybridEnabled: envBoolean("PINECONE_HYBRID_ENABLED", true),
    sparseModel: Deno.env.get("PINECONE_SPARSE_MODEL")?.trim() || "pinecone-sparse-english-v0",
    rerankEnabled: envBoolean("PINECONE_RERANK_ENABLED", true),
    rerankModel: Deno.env.get("PINECONE_RERANK_MODEL")?.trim() || "bge-reranker-v2-m3",
    hybridAlpha: envNumber("PINECONE_HYBRID_ALPHA", 0.65, 0, 1),
    retrievalMode,
  };
}

export function isPineconeConfigured(): boolean {
  return pineconeConfig().apiKey.length > 0;
}

export function pineconeNamespace(projectId: string): string {
  return `project-${projectId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export function pineconeVectorId(sourceId: string, contentVersion: number, chunkIndex: number): string {
  return `${sourceId}#v${Math.max(1, Math.floor(contentVersion))}#c${Math.max(0, Math.floor(chunkIndex))}`;
}

function trustedDataPlaneUrl(host: string, path: string): string {
  const candidate = host.startsWith("http") ? host : `https://${host}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith(".pinecone.io")) {
    throw new Error("Pinecone returned an untrusted index host.");
  }
  url.pathname = path;
  url.search = "";
  return url.toString();
}

async function pineconeRequest<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = CONTROL_TIMEOUT_MS,
): Promise<T> {
  const config = pineconeConfig();
  if (!config.apiKey) throw new Error("PINECONE_API_KEY is not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Api-Key": config.apiKey,
        "X-Pinecone-Api-Version": config.apiVersion,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.text();
    let body: T;
    try {
      body = raw ? JSON.parse(raw) as T : {} as T;
    } catch {
      body = { message: raw } as T;
    }
    if (!response.ok) {
      const detail = typeof body === "object" && body !== null
        ? String((body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error ?? raw)
        : raw;
      const error = new Error(`Pinecone request failed (${response.status}): ${detail.slice(0, 500)}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`Pinecone request timed out after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateIndex(index: PineconeIndexDescription): PineconeIndexDescription {
  const config = pineconeConfig();
  const expectedMetric = config.hybridEnabled ? "dotproduct" : "cosine";
  if (index.dimension !== config.dimension) {
    throw new Error(`Pinecone index ${index.name} has dimension ${index.dimension}; expected ${config.dimension}.`);
  }
  if (index.metric !== expectedMetric) {
    throw new Error(
      `Pinecone index ${index.name} uses ${index.metric}; expected ${expectedMetric}. ` +
        "Use a separate dotproduct v2 index for dense+sparse hybrid retrieval.",
    );
  }
  trustedDataPlaneUrl(index.host, "/query");
  return index;
}

let cachedIndex: { value: PineconeIndexDescription; expiresAt: number } | null = null;

export async function describePineconeIndex(options: { force?: boolean } = {}): Promise<PineconeIndexDescription | null> {
  if (!isPineconeConfigured()) return null;
  const config = pineconeConfig();
  if (!options.force && cachedIndex && cachedIndex.expiresAt > Date.now()) return cachedIndex.value;
  if (!options.force && config.indexHost) {
    const configured = validateIndex({
      name: config.indexName,
      host: config.indexHost,
      dimension: config.dimension,
      metric: config.hybridEnabled ? "dotproduct" : "cosine",
      status: { ready: true, state: "ConfiguredHost" },
    });
    cachedIndex = { value: configured, expiresAt: Date.now() + HOST_CACHE_MS };
    return configured;
  }
  try {
    const index = validateIndex(await pineconeRequest<PineconeIndexDescription>(
      `${CONTROL_PLANE_URL}/indexes/${encodeURIComponent(config.indexName)}`,
    ));
    cachedIndex = { value: index, expiresAt: Date.now() + HOST_CACHE_MS };
    return index;
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return null;
    throw error;
  }
}

export async function ensurePineconeIndex(): Promise<PineconeIndexDescription> {
  const existing = await describePineconeIndex({ force: true });
  if (existing && existing.status?.ready !== false) return existing;

  const config = pineconeConfig();
  let index = existing;
  if (!index) {
    index = validateIndex(await pineconeRequest<PineconeIndexDescription>(`${CONTROL_PLANE_URL}/indexes`, {
      method: "POST",
      body: JSON.stringify({
        name: config.indexName,
        vector_type: "dense",
        dimension: config.dimension,
        metric: config.hybridEnabled ? "dotproduct" : "cosine",
        spec: { serverless: { cloud: config.cloud, region: config.region } },
        deletion_protection: "enabled",
        tags: { application: "oxus-cloud", purpose: "project-knowledge-v2" },
      }),
    }));
  }

  for (let attempt = 0; attempt < 12 && index.status?.ready === false; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    index = await describePineconeIndex({ force: true }) ?? index;
  }
  cachedIndex = { value: index, expiresAt: Date.now() + HOST_CACHE_MS };
  return index;
}

export async function generatePineconeSparseVectors(
  texts: string[],
  inputType: "query" | "passage",
): Promise<Array<PineconeSparseVector | null>> {
  const config = pineconeConfig();
  if (!config.hybridEnabled || texts.length === 0) return texts.map(() => null);
  const result = await pineconeRequest<{
    data?: Array<{ sparse_indices?: number[]; sparse_values?: number[]; indices?: number[]; values?: number[] }>;
  }>(`${CONTROL_PLANE_URL}/embed`, {
    method: "POST",
    body: JSON.stringify({
      model: config.sparseModel,
      parameters: { input_type: inputType, truncate: "END", max_tokens_per_sequence: 2048 },
      inputs: texts.map((text) => ({ text })),
    }),
  }, INGEST_TIMEOUT_MS);
  return texts.map((_, index) => {
    const row = result.data?.[index];
    const indices = row?.sparse_indices ?? row?.indices;
    const values = row?.sparse_values ?? row?.values;
    return indices && values && indices.length === values.length ? { indices, values } : null;
  });
}

export async function upsertPineconeVectors(args: {
  projectId: string;
  vectors: PineconeVector[];
}): Promise<{ upsertedCount: number }> {
  if (args.vectors.length === 0) return { upsertedCount: 0 };
  const index = await ensurePineconeIndex();
  if (index.status?.ready === false) throw new Error(`Pinecone index is ${index.status.state ?? "not ready"}.`);
  const result = await pineconeRequest<{ upsertedCount?: number }>(trustedDataPlaneUrl(index.host, "/vectors/upsert"), {
    method: "POST",
    body: JSON.stringify({ namespace: pineconeNamespace(args.projectId), vectors: args.vectors }),
  }, INGEST_TIMEOUT_MS);
  return { upsertedCount: result.upsertedCount ?? args.vectors.length };
}

function scale(values: number[], factor: number): number[] {
  return factor === 1 ? values : values.map((value) => value * factor);
}

export async function queryPinecone(args: {
  projectId: string;
  vector: number[];
  sparseVector?: PineconeSparseVector | null;
  topK: number;
  filter?: Record<string, unknown>;
}): Promise<PineconeMatch[]> {
  const index = await describePineconeIndex();
  if (!index) throw new Error(`Pinecone index ${pineconeConfig().indexName} does not exist yet.`);
  if (index.status?.ready === false) throw new Error(`Pinecone index is ${index.status.state ?? "not ready"}.`);
  const config = pineconeConfig();
  const hasSparse = !!args.sparseVector?.indices.length;
  const alpha = hasSparse ? config.hybridAlpha : 1;
  const result = await pineconeRequest<{ matches?: Array<{ id?: string; score?: number; metadata?: Record<string, unknown> }> }>(
    trustedDataPlaneUrl(index.host, "/query"),
    {
      method: "POST",
      body: JSON.stringify({
        namespace: pineconeNamespace(args.projectId),
        vector: scale(args.vector, alpha),
        ...(hasSparse
          ? { sparseVector: { indices: args.sparseVector!.indices, values: scale(args.sparseVector!.values, 1 - alpha) } }
          : {}),
        topK: Math.max(1, Math.min(args.topK, 100)),
        includeMetadata: true,
        includeValues: false,
        ...(args.filter ? { filter: args.filter } : {}),
      }),
    },
    QUERY_TIMEOUT_MS,
  );
  return (result.matches ?? []).flatMap((match) => match.id
    ? [{ id: match.id, score: match.score ?? 0, metadata: match.metadata }]
    : []);
}

export async function rerankPinecone(args: {
  query: string;
  documents: PineconeRerankDocument[];
  topN: number;
}): Promise<Array<{ id: string; score: number }>> {
  const config = pineconeConfig();
  if (!config.rerankEnabled || args.documents.length === 0) {
    return args.documents.slice(0, args.topN).map((document, index) => ({ id: document.id, score: 1 - index / 100 }));
  }
  const result = await pineconeRequest<{
    data?: Array<{ index?: number; score?: number; document?: { id?: string } }>;
  }>(`${CONTROL_PLANE_URL}/rerank`, {
    method: "POST",
    body: JSON.stringify({
      model: config.rerankModel,
      query: args.query,
      documents: args.documents.map((document) => ({ id: document.id, text: document.text })),
      top_n: Math.max(1, Math.min(args.topN, args.documents.length)),
      return_documents: false,
      parameters: { truncate: "END" },
    }),
  }, INGEST_TIMEOUT_MS);
  return (result.data ?? []).flatMap((row) => {
    const id = row.document?.id ?? (typeof row.index === "number" ? args.documents[row.index]?.id : undefined);
    return id ? [{ id, score: row.score ?? 0 }] : [];
  });
}

export async function deletePineconeSource(projectId: string, sourceId: string): Promise<void> {
  const index = await describePineconeIndex();
  if (!index) return;
  try {
    await pineconeRequest(trustedDataPlaneUrl(index.host, "/vectors/delete"), {
      method: "POST",
      body: JSON.stringify({ namespace: pineconeNamespace(projectId), filter: { source_id: { $eq: sourceId } } }),
    }, INGEST_TIMEOUT_MS);
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 404) throw error;
  }
}

export async function deletePineconeSourceVersionsBefore(
  projectId: string,
  sourceId: string,
  contentVersion: number,
): Promise<void> {
  if (contentVersion <= 1) return;
  const index = await describePineconeIndex();
  if (!index) return;
  await pineconeRequest(trustedDataPlaneUrl(index.host, "/vectors/delete"), {
    method: "POST",
    body: JSON.stringify({
      namespace: pineconeNamespace(projectId),
      filter: {
        $and: [
          { source_id: { $eq: sourceId } },
          { content_version: { $lt: contentVersion } },
        ],
      },
    }),
  }, INGEST_TIMEOUT_MS);
}

export async function deletePineconeNamespace(projectId: string): Promise<void> {
  const index = await describePineconeIndex();
  if (!index) return;
  const namespace = encodeURIComponent(pineconeNamespace(projectId));
  try {
    await pineconeRequest(trustedDataPlaneUrl(index.host, `/namespaces/${namespace}`), { method: "DELETE" }, INGEST_TIMEOUT_MS);
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 404) throw error;
  }
}

export async function describePineconeNamespace(projectId: string): Promise<{ vectorCount: number }> {
  const index = await describePineconeIndex();
  if (!index) return { vectorCount: 0 };
  const namespace = encodeURIComponent(pineconeNamespace(projectId));
  try {
    const result = await pineconeRequest<{ record_count?: number; recordCount?: number }>(
      trustedDataPlaneUrl(index.host, `/namespaces/${namespace}`),
      {},
      QUERY_TIMEOUT_MS,
    );
    return { vectorCount: result.record_count ?? result.recordCount ?? 0 };
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return { vectorCount: 0 };
    throw error;
  }
}
