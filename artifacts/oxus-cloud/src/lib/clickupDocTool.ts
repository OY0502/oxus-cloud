/** Mirror of server CLICKUP_DOC_MIN_CONTENT_LENGTH — keep in sync with clickupDocTool.ts */
export const CLICKUP_DOC_MIN_CONTENT_LENGTH = 100;

export function docContentFromPayload(payload: Record<string, unknown>): string {
  const val = (key: string) => (typeof payload[key] === "string" ? payload[key] as string : "");
  return (
    val("content_markdown") ||
    val("markdown_content") ||
    val("markdown") ||
    val("content") ||
    val("body") ||
    val("document_content") ||
    val("doc_content")
  );
}

export function docTitleFromPayload(payload: Record<string, unknown>): string {
  const val = (key: string) => (typeof payload[key] === "string" ? payload[key] as string : "");
  return val("title") || val("name") || val("doc_title");
}

export function destinationFromPayload(payload: Record<string, unknown>): {
  type?: string;
  id?: string;
  name?: string;
  path?: string;
  reason?: string;
} | null {
  const dest = payload.destination;
  if (!dest || typeof dest !== "object" || Array.isArray(dest)) return null;
  const d = dest as Record<string, unknown>;
  return {
    type: typeof d.type === "string" ? d.type : undefined,
    id: typeof d.id === "string" ? d.id : undefined,
    name: typeof d.name === "string" ? d.name : undefined,
    path: typeof d.path === "string" ? d.path : undefined,
    reason: typeof d.reason === "string" ? d.reason : undefined,
  };
}

export function sourceContextFromPayload(payload: Record<string, unknown>): {
  request_text?: string;
  agent_run_id?: string;
} {
  const ctx = payload.source_context;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return {};
  const c = ctx as Record<string, unknown>;
  return {
    request_text: typeof c.request_text === "string" ? c.request_text : undefined,
    agent_run_id: typeof c.agent_run_id === "string" ? c.agent_run_id : undefined,
  };
}

export function isClickupDocContentValid(content: string): boolean {
  return content.trim().length >= CLICKUP_DOC_MIN_CONTENT_LENGTH;
}
