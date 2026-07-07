import type { TraceMetadata } from "./types.ts";

/** Minimum markdown length before a create_clickup_doc confirmation may be created. */
export const CLICKUP_DOC_MIN_CONTENT_LENGTH = 100;

export type CreateClickupDocPayload = {
  title: string;
  content_markdown: string;
  parent?: {
    type: "workspace" | "space" | "folder" | "list";
    id?: string;
  };
  destination?: {
    type: "workspace" | "space" | "folder" | "list";
    id: string;
    name: string;
    path: string;
    reason: string;
  };
  source_context?: {
    agent_run_id?: string;
    project_id?: string;
    request_text?: string;
  };
};

const LEGACY_CONTENT_KEYS = [
  "content_markdown",
  "markdown_content",
  "markdown",
  "content",
  "body",
  "document_content",
  "doc_content",
  "text",
] as const;

/** Extract tool input from plan tool_call (supports input, input_payload, or top-level fields). */
export function extractToolCallInput(toolCall: Record<string, unknown>): Record<string, unknown> {
  const nested = toolCall.input ?? toolCall.input_payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>) };
  }

  const direct: Record<string, unknown> = {};
  for (const key of ["title", "name", "doc_title", ...LEGACY_CONTENT_KEYS, "parent", "destination", "source_context"]) {
    if (toolCall[key] !== undefined && toolCall[key] !== null) {
      direct[key] = toolCall[key];
    }
  }
  return direct;
}

export function normalizeCreateClickupDocPayload(
  raw: Record<string, unknown>,
  sourceContext?: CreateClickupDocPayload["source_context"],
): { payload: CreateClickupDocPayload; normalizationApplied: boolean } {
  let source = raw;
  if (raw.input_payload && typeof raw.input_payload === "object" && !Array.isArray(raw.input_payload)) {
    source = { ...source, ...(raw.input_payload as Record<string, unknown>) };
  }
  if (raw.input && typeof raw.input === "object" && !Array.isArray(raw.input)) {
    source = { ...source, ...(raw.input as Record<string, unknown>) };
  }

  let title = String(source.title ?? source.name ?? source.doc_title ?? "").trim();
  let content_markdown = "";
  let normalizationApplied = false;

  if (source.content_markdown && typeof source.content_markdown === "string" && source.content_markdown.trim()) {
    content_markdown = source.content_markdown.trim();
  } else {
    for (const key of LEGACY_CONTENT_KEYS) {
      if (key === "content_markdown") continue;
      const val = source[key];
      if (typeof val === "string" && val.trim()) {
        content_markdown = val.trim();
        normalizationApplied = true;
        break;
      }
    }
  }

  if (!title && content_markdown) {
    const heading = content_markdown.match(/^#\s+(.+)$/m);
    if (heading?.[1]) title = heading[1].trim();
  }

  const payload: CreateClickupDocPayload = {
    title,
    content_markdown,
  };

  if (source.parent && typeof source.parent === "object" && !Array.isArray(source.parent)) {
    const parent = source.parent as Record<string, unknown>;
    const type = parent.type;
    if (type === "workspace" || type === "space" || type === "folder" || type === "list") {
      payload.parent = {
        type,
        id: typeof parent.id === "string" ? parent.id : undefined,
      };
    }
  }

  if (source.destination && typeof source.destination === "object" && !Array.isArray(source.destination)) {
    const dest = source.destination as Record<string, unknown>;
    const type = dest.type;
    if (type === "workspace" || type === "space" || type === "folder" || type === "list") {
      payload.destination = {
        type,
        id: String(dest.id ?? ""),
        name: String(dest.name ?? ""),
        path: String(dest.path ?? dest.name ?? ""),
        reason: String(dest.reason ?? ""),
      };
      if (!payload.parent && payload.destination.id) {
        payload.parent = { type, id: payload.destination.id };
      }
    }
  }

  const ctx = source.source_context ?? sourceContext;
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
    payload.source_context = ctx as CreateClickupDocPayload["source_context"];
  } else if (sourceContext) {
    payload.source_context = sourceContext;
  }

  return { payload, normalizationApplied };
}

export function validateCreateClickupDocPayload(payload: CreateClickupDocPayload): void {
  if (!payload.title.trim()) {
    throw new Error("ClickUp document title is required.");
  }
  const contentLen = payload.content_markdown.trim().length;
  if (contentLen < CLICKUP_DOC_MIN_CONTENT_LENGTH) {
    throw new Error(
      `ClickUp document content must be at least ${CLICKUP_DOC_MIN_CONTENT_LENGTH} characters before confirmation (got ${contentLen}).`,
    );
  }
}

export function createClickupDocPayloadForStorage(payload: CreateClickupDocPayload): Record<string, unknown> {
  return {
    title: payload.title.trim(),
    content_markdown: payload.content_markdown.trim(),
    ...(payload.parent ? { parent: payload.parent } : {}),
    ...(payload.destination ? { destination: payload.destination } : {}),
    ...(payload.source_context ? { source_context: payload.source_context } : {}),
  };
}

export function mergeAndValidateClickupDocPayload(
  stored: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const { payload } = normalizeCreateClickupDocPayload({ ...stored, ...(overrides ?? {}) });
  validateCreateClickupDocPayload(payload);
  logClickupDocToolPayload({
    phase: "confirm",
    titleLength: payload.title.length,
    contentLength: payload.content_markdown.length,
    normalizationApplied: false,
    agentRunId: payload.source_context?.agent_run_id,
  });
  return createClickupDocPayloadForStorage(payload);
}

export function logClickupDocToolPayload(args: {
  phase: string;
  titleLength: number;
  contentLength: number;
  normalizationApplied: boolean;
  agentRunId?: string;
}): void {
  console.info("[create_clickup_doc]", {
    phase: args.phase,
    title_length: args.titleLength,
    content_length: args.contentLength,
    normalization_applied: args.normalizationApplied,
    agent_run_id: args.agentRunId ?? null,
  });
}

export type ClickupDocLangSmithMeta = {
  tool_name: "create_clickup_doc";
  title: string;
  title_length: number;
  content_length: number;
  normalization_applied: boolean;
  destination_path?: string;
  destination_reason?: string;
};

export function clickupDocLangSmithMeta(
  payload: CreateClickupDocPayload,
  normalizationApplied: boolean,
): ClickupDocLangSmithMeta {
  return {
    tool_name: "create_clickup_doc",
    title: payload.title,
    title_length: payload.title.length,
    content_length: payload.content_markdown.length,
    normalization_applied: normalizationApplied,
    destination_path: payload.destination?.path,
    destination_reason: payload.destination?.reason,
  };
}
