const MIN_CHUNK_CHARS = 30;
const DEFAULT_BATCH = 32;

export type EmbeddingProviderMode = "openrouter" | "openai" | "disabled";

export function resolveEmbeddingProvider(): EmbeddingProviderMode {
  const raw = Deno.env.get("EMBEDDING_PROVIDER")?.trim().toLowerCase();
  if (!raw || raw === "disabled" || raw === "none" || raw === "off") return "disabled";
  if (raw === "openrouter") return "openrouter";
  if (raw === "openai") return "openai";
  return "disabled";
}

export function isEmbeddingsEnabled(): boolean {
  const provider = resolveEmbeddingProvider();
  if (provider === "openrouter") return !!Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (provider === "openai") return !!Deno.env.get("OPENAI_API_KEY")?.trim();
  return false;
}

export function embeddingsDisabledReason(): string {
  const provider = resolveEmbeddingProvider();
  if (provider === "disabled") return "No embedding provider configured";
  if (provider === "openrouter" && !Deno.env.get("OPENROUTER_API_KEY")?.trim()) {
    return "OPENROUTER_API_KEY is not set";
  }
  if (provider === "openai" && !Deno.env.get("OPENAI_API_KEY")?.trim()) return "OPENAI_API_KEY is not set";
  return "";
}

export function embeddingConfig() {
  const provider = resolveEmbeddingProvider();
  return {
    provider,
    enabled: isEmbeddingsEnabled(),
    model: Deno.env.get("EMBEDDING_MODEL")?.trim() ||
      (provider === "openrouter" ? "openai/text-embedding-3-small" : "text-embedding-3-small"),
    dimensions: Number(Deno.env.get("EMBEDDING_DIMENSIONS") ?? "1536"),
  };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!isEmbeddingsEnabled()) return [];

  const { provider, model, dimensions } = embeddingConfig();
  const apiKey = provider === "openrouter"
    ? Deno.env.get("OPENROUTER_API_KEY")!.trim()
    : Deno.env.get("OPENAI_API_KEY")!.trim();
  const baseUrl = provider === "openrouter"
    ? (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")
    : "https://api.openai.com/v1";
  const eligible = texts.map((t) => t.trim()).filter((t) => t.length >= MIN_CHUNK_CHARS);
  if (eligible.length === 0) return [];

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(provider === "openrouter" && Deno.env.get("OPENROUTER_SITE_URL")?.trim()
        ? { "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL")!.trim() }
        : {}),
      ...(provider === "openrouter"
        ? { "X-Title": Deno.env.get("OPENROUTER_APP_NAME")?.trim() || "OXUS Cloud" }
        : {}),
    },
    body: JSON.stringify({
      model,
      input: eligible,
      dimensions,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${provider} embeddings failed (${response.status}): ${body.slice(0, 800)}`);
  }

  const parsed = JSON.parse(body) as { data?: { embedding: number[]; index: number }[] };
  const rows = parsed.data ?? [];
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (!isEmbeddingsEnabled()) return null;
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  const { provider, model, dimensions } = embeddingConfig();
  const apiKey = provider === "openrouter"
    ? Deno.env.get("OPENROUTER_API_KEY")!.trim()
    : Deno.env.get("OPENAI_API_KEY")!.trim();
  const baseUrl = provider === "openrouter"
    ? (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")
    : "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(provider === "openrouter" && Deno.env.get("OPENROUTER_SITE_URL")?.trim()
        ? { "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL")!.trim() }
        : {}),
      ...(provider === "openrouter"
        ? { "X-Title": Deno.env.get("OPENROUTER_APP_NAME")?.trim() || "OXUS Cloud" }
        : {}),
    },
    body: JSON.stringify({ model, input: [trimmed], dimensions }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${provider} embeddings failed (${response.status}): ${body.slice(0, 800)}`);
  const parsed = JSON.parse(body) as { data?: { embedding: number[]; index: number }[] };
  return parsed.data?.sort((a, b) => a.index - b.index)[0]?.embedding ?? null;
}

export { MIN_CHUNK_CHARS, DEFAULT_BATCH };
