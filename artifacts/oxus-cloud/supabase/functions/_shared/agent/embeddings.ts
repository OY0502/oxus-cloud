const MIN_CHUNK_CHARS = 30;
const DEFAULT_BATCH = 32;

export type EmbeddingProviderMode = "openai" | "disabled";

export function resolveEmbeddingProvider(): EmbeddingProviderMode {
  const raw = Deno.env.get("EMBEDDING_PROVIDER")?.trim().toLowerCase();
  if (!raw || raw === "disabled" || raw === "none" || raw === "off") return "disabled";
  if (raw === "openai") return "openai";
  return "disabled";
}

export function isEmbeddingsEnabled(): boolean {
  if (resolveEmbeddingProvider() !== "openai") return false;
  return !!Deno.env.get("OPENAI_API_KEY")?.trim();
}

export function embeddingsDisabledReason(): string {
  const provider = resolveEmbeddingProvider();
  if (provider !== "openai") return "No embedding provider configured";
  if (!Deno.env.get("OPENAI_API_KEY")?.trim()) return "OPENAI_API_KEY is not set";
  return "";
}

export function embeddingConfig() {
  const provider = resolveEmbeddingProvider();
  return {
    provider,
    enabled: isEmbeddingsEnabled(),
    model: Deno.env.get("EMBEDDING_MODEL")?.trim() || "text-embedding-3-small",
    dimensions: Number(Deno.env.get("EMBEDDING_DIMENSIONS") ?? "1536"),
  };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!isEmbeddingsEnabled()) return [];

  const apiKey = Deno.env.get("OPENAI_API_KEY")!.trim();
  const { model, dimensions } = embeddingConfig();
  const eligible = texts.map((t) => t.trim()).filter((t) => t.length >= MIN_CHUNK_CHARS);
  if (eligible.length === 0) return [];

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: eligible,
      dimensions,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI embeddings failed (${response.status}): ${body.slice(0, 800)}`);
  }

  const parsed = JSON.parse(body) as { data?: { embedding: number[]; index: number }[] };
  const rows = parsed.data ?? [];
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (!isEmbeddingsEnabled()) return null;
  const trimmed = text.trim();
  if (trimmed.length < MIN_CHUNK_CHARS) return null;
  const [embedding] = await embedTexts([trimmed]);
  return embedding ?? null;
}

export { MIN_CHUNK_CHARS, DEFAULT_BATCH };
