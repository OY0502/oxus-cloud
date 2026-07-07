export type TraceMetadata = {
  project_id?: string;
  agent_run_id?: string;
  tool_run_id?: string;
  tool_name?: string;
  source_type?: string;
  source?: string;
  runtime?: string;
  model?: string;
  prompt_type?: string;
  chunks_retrieved_count?: number;
  clickup_doc_chunks_retrieved?: number;
  clickup_destination?: string;
  open_questions_count?: number;
  resolved_count?: number;
  updated_count?: number;
  kept_open_count?: number;
  new_questions_count?: number;
};

export function isLangfuseEnabled(): boolean {
  const enabled = Deno.env.get("LANGFUSE_ENABLED")?.trim().toLowerCase();
  if (enabled === "false" || enabled === "0") return false;
  return !!(
    Deno.env.get("LANGFUSE_SECRET_KEY")?.trim() &&
    Deno.env.get("LANGFUSE_PUBLIC_KEY")?.trim()
  );
}

export function langfuseBaseUrl(): string {
  return (Deno.env.get("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com").replace(/\/+$/, "");
}

export function buildLangfuseTraceUrl(traceId?: string | null): string | undefined {
  if (!isLangfuseEnabled() || !traceId) return undefined;
  const host = langfuseBaseUrl().replace(/^https?:\/\//, "");
  return `https://${host}/trace/${traceId}`;
}

type IngestionEvent = {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
};

function newEventId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function basicAuthHeader(): string {
  const publicKey = Deno.env.get("LANGFUSE_PUBLIC_KEY")!.trim();
  const secretKey = Deno.env.get("LANGFUSE_SECRET_KEY")!.trim();
  return `Basic ${btoa(`${publicKey}:${secretKey}`)}`;
}

function sanitizeForTrace(value: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    "authorization", "access_token", "api_key", "secret", "password", "token",
    "access_token_encrypted", "encrypted",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (blocked.has(key.toLowerCase())) {
      out[key] = "[redacted]";
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = sanitizeForTrace(val as Record<string, unknown>);
      continue;
    }
    out[key] = val;
  }
  return out;
}

async function ingestBatch(events: IngestionEvent[]): Promise<void> {
  if (!isLangfuseEnabled() || events.length === 0) return;
  const response = await fetch(`${langfuseBaseUrl()}/api/public/ingestion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthHeader(),
    },
    body: JSON.stringify({ batch: events }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.warn("[langfuse] ingestion failed:", response.status, text.slice(0, 300));
  }
}

export type LangfuseTraceHandle = {
  traceId: string;
  generationId?: string;
};

/** Create a Langfuse trace + optional root span via ingestion API (Deno-safe). */
export async function createLangfuseTrace(args: {
  name: string;
  metadata?: TraceMetadata;
  input?: Record<string, unknown>;
}): Promise<LangfuseTraceHandle | null> {
  if (!isLangfuseEnabled()) return null;

  const traceId = crypto.randomUUID();
  const spanId = crypto.randomUUID();
  const timestamp = nowIso();
  const metadata = sanitizeForTrace(args.metadata ?? {});

  await ingestBatch([
    {
      id: newEventId(),
      type: "trace-create",
      timestamp,
      body: {
        id: traceId,
        timestamp,
        name: args.name,
        input: args.input ? sanitizeForTrace(args.input) : undefined,
        metadata,
        tags: ["oxus-cloud", args.metadata?.source ?? "agent"].filter(Boolean),
      },
    },
    {
      id: newEventId(),
      type: "span-create",
      timestamp,
      body: {
        id: spanId,
        traceId,
        name: args.name,
        startTime: timestamp,
        input: args.input ? sanitizeForTrace(args.input) : undefined,
        metadata,
      },
    },
  ]);

  return { traceId, generationId: spanId };
}

export async function createLangfuseGeneration(args: {
  traceId: string;
  name: string;
  model?: string;
  metadata?: TraceMetadata;
  input?: Record<string, unknown>;
}): Promise<string | null> {
  if (!isLangfuseEnabled()) return null;

  const generationId = crypto.randomUUID();
  const timestamp = nowIso();

  await ingestBatch([
    {
      id: newEventId(),
      type: "generation-create",
      timestamp,
      body: {
        id: generationId,
        traceId: args.traceId,
        name: args.name,
        startTime: timestamp,
        model: args.model,
        input: args.input ? sanitizeForTrace(args.input) : undefined,
        metadata: sanitizeForTrace(args.metadata ?? {}),
      },
    },
  ]);

  return generationId;
}

export async function patchLangfuseGeneration(
  generationId: string,
  patch: {
    output?: Record<string, unknown>;
    error?: string;
    metadata?: TraceMetadata;
  },
): Promise<void> {
  if (!isLangfuseEnabled()) return;
  const timestamp = nowIso();
  await ingestBatch([
    {
      id: newEventId(),
      type: "generation-update",
      timestamp,
      body: {
        id: generationId,
        endTime: timestamp,
        output: patch.output ? sanitizeForTrace(patch.output) : undefined,
        statusMessage: patch.error,
        level: patch.error ? "ERROR" : undefined,
        metadata: patch.metadata ? sanitizeForTrace(patch.metadata) : undefined,
      },
    },
  ]);
}

export async function patchLangfuseTrace(
  traceId: string,
  patch: {
    output?: Record<string, unknown>;
    error?: string;
    metadata?: TraceMetadata;
  },
): Promise<void> {
  if (!isLangfuseEnabled()) return;
  const timestamp = nowIso();
  await ingestBatch([
    {
      id: newEventId(),
      type: "trace-create",
      timestamp,
      body: {
        id: traceId,
        timestamp,
        output: patch.output ? sanitizeForTrace(patch.output) : undefined,
        metadata: patch.metadata ? sanitizeForTrace(patch.metadata) : undefined,
      },
    },
  ]);
}
