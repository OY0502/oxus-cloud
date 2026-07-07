import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { clickupAuthorizationHeader } from "../clickup.ts";
import type { ClickupApiEnv } from "../clickup.ts";

export type ClickupDocCreateInput = {
  title: string;
  markdown_content: string;
  workspace_id: string;
  space_id?: string;
  folder_id?: string;
  list_id?: string;
};

export type ClickupDocCreateResult = {
  doc_id: string;
  doc_url: string;
  title: string;
};

const CLICKUP_V3_BASE = "https://api.clickup.com/api/v3";

export function normalizeClickupDocPayload(payload: Record<string, unknown>): { title: string; markdown: string } {
  if (payload.input_payload && typeof payload.input_payload === "object" && !Array.isArray(payload.input_payload)) {
    const nested = normalizeClickupDocPayload(payload.input_payload as Record<string, unknown>);
    if (nested.title || nested.markdown) return nested;
  }
  if (payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)) {
    const nested = normalizeClickupDocPayload(payload.input as Record<string, unknown>);
    if (nested.title || nested.markdown) return nested;
  }

  let title = String(payload.title ?? payload.name ?? payload.doc_title ?? "").trim();
  let markdown = String(
    payload.content_markdown ??
      payload.markdown_content ??
      payload.content ??
      payload.markdown ??
      payload.body ??
      payload.document_content ??
      payload.doc_content ??
      payload.text ??
      "",
  ).trim();

  if (!title && markdown) {
    const heading = markdown.match(/^#\s+(.+)$/m);
    if (heading?.[1]) title = heading[1].trim();
  }
  if (!title) title = "Project document";

  return { title, markdown };
}

type DocParent = { id: string; type: 4 | 5 | 6 };
type DocVisibility = "PUBLIC" | "PRIVATE" | "PERSONAL";

function buildDocCreateAttempts(input: ClickupDocCreateInput): Array<{ parent: DocParent; visibility: DocVisibility }> {
  const attempts: Array<{ parent: DocParent; visibility: DocVisibility }> = [];
  const listId = input.list_id?.trim();
  const folderId = input.folder_id?.trim();
  const spaceId = input.space_id?.trim();

  if (listId) {
    attempts.push({ parent: { id: listId, type: 6 }, visibility: "PUBLIC" });
    attempts.push({ parent: { id: listId, type: 6 }, visibility: "PERSONAL" });
  }
  if (folderId) {
    attempts.push({ parent: { id: folderId, type: 5 }, visibility: "PUBLIC" });
    attempts.push({ parent: { id: folderId, type: 5 }, visibility: "PERSONAL" });
  }
  if (spaceId) {
    attempts.push({ parent: { id: spaceId, type: 4 }, visibility: "PUBLIC" });
    attempts.push({ parent: { id: spaceId, type: 4 }, visibility: "PERSONAL" });
    attempts.push({ parent: { id: spaceId, type: 4 }, visibility: "PRIVATE" });
  }

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = `${attempt.parent.type}:${attempt.parent.id}:${attempt.visibility}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRetriableDocCreateError(message: string): boolean {
  return /INSUFFICIENT_ACCESS|create_private_view|EXTRA_AUTHZ|not_found_or_authorized|403/i.test(message);
}

function formatDocPermissionError(lastError: string): string {
  if (/create_private_view|INSUFFICIENT_ACCESS|EXTRA_AUTHZ/i.test(lastError)) {
    return [
      "Your ClickUp account cannot create Docs in this project's space (missing create_private_view permission).",
      "Try reconnecting with a workspace admin account, or link a different space under Project → ClickUp.",
      "A workspace admin can also grant you permission to create views in that space.",
      `ClickUp: ${lastError.slice(0, 400)}`,
    ].join(" ");
  }
  return lastError;
}

function extractPageIdFromCreateResponse(doc: Record<string, unknown>): string | null {
  const page = doc.page as Record<string, unknown> | undefined;
  const direct = doc.page_id ?? page?.id;
  if (direct != null && String(direct).trim()) return String(direct);

  const pages = doc.pages;
  if (Array.isArray(pages)) {
    for (const entry of pages) {
      if (entry && typeof entry === "object" && (entry as Record<string, unknown>).id != null) {
        return String((entry as Record<string, unknown>).id);
      }
    }
  }
  return null;
}

function flattenDocPages(pages: unknown[]): Array<{ id: string; name?: string }> {
  const out: Array<{ id: string; name?: string }> = [];
  for (const entry of pages) {
    if (!entry || typeof entry !== "object") continue;
    const page = entry as Record<string, unknown>;
    if (page.id != null) {
      out.push({
        id: String(page.id),
        name: typeof page.name === "string" ? page.name : undefined,
      });
    }
    if (Array.isArray(page.pages)) out.push(...flattenDocPages(page.pages));
  }
  return out;
}

async function listClickupDocPages(
  clickup: ClickupApiEnv,
  workspaceId: string,
  docId: string,
): Promise<Array<{ id: string; name?: string }>> {
  const response = await fetch(
    `${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs/${docId}/pages?max_page_depth=-1`,
    { headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) } },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp list doc pages failed (${response.status}): ${text.slice(0, 400)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`ClickUp list doc pages returned non-JSON: ${text.slice(0, 400)}`);
  }

  if (Array.isArray(parsed)) return flattenDocPages(parsed);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.pages)) return flattenDocPages(record.pages);
  }
  return [];
}

async function createClickupDocPage(
  clickup: ClickupApiEnv,
  workspaceId: string,
  docId: string,
  title: string,
  markdown: string,
): Promise<string> {
  const response = await fetch(`${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs/${docId}/pages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(clickup.apiToken),
    },
    body: JSON.stringify({
      name: title,
      content: markdown,
      content_format: "text/md",
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp create doc page failed (${response.status}): ${text.slice(0, 800)}`);
  }

  let page: Record<string, unknown>;
  try {
    page = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`ClickUp create doc page returned non-JSON: ${text.slice(0, 400)}`);
  }
  const pageId = String(page.id ?? "");
  if (!pageId) throw new Error("ClickUp create doc page response missing page id.");
  return pageId;
}

async function populateClickupDocPage(args: {
  clickup: ClickupApiEnv;
  workspaceId: string;
  docId: string;
  title: string;
  markdown: string;
  createResponse: Record<string, unknown>;
}): Promise<void> {
  if (!args.markdown.trim()) return;

  let pageId = extractPageIdFromCreateResponse(args.createResponse);
  if (!pageId) {
    const pages = await listClickupDocPages(args.clickup, args.workspaceId, args.docId);
    pageId = pages[0]?.id ?? null;
  }
  if (!pageId) {
    await createClickupDocPage(args.clickup, args.workspaceId, args.docId, args.title, args.markdown);
    return;
  }

  await updateClickupDocPageContent(
    args.clickup,
    args.workspaceId,
    args.docId,
    pageId,
    args.title,
    args.markdown,
  );
}

async function createClickupDocOnce(
  clickup: ClickupApiEnv,
  input: ClickupDocCreateInput,
  attempt: { parent: DocParent; visibility: DocVisibility },
): Promise<ClickupDocCreateResult> {
  const workspaceId = input.workspace_id.trim();
  const title = input.title.trim();
  if (!workspaceId || !title) {
    throw new Error("workspace_id and title are required for ClickUp doc creation.");
  }

  const response = await fetch(`${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(clickup.apiToken),
    },
    body: JSON.stringify({
      name: title,
      parent: attempt.parent,
      visibility: attempt.visibility,
      create_page: true,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `ClickUp Doc API create failed (${response.status}, parent=${attempt.parent.type}, visibility=${attempt.visibility}): ${text.slice(0, 800)}`,
    );
  }

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`ClickUp Doc API returned non-JSON: ${text.slice(0, 400)}`);
  }

  const docId = String(doc.id ?? doc.doc_id ?? "");
  if (!docId) throw new Error("ClickUp Doc API response missing doc id.");

  await populateClickupDocPage({
    clickup,
    workspaceId,
    docId,
    title,
    markdown: input.markdown_content,
    createResponse: doc,
  });

  const resolvedTitle = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : title;
  const docUrl = typeof doc.url === "string"
    ? doc.url
    : `https://app.clickup.com/${workspaceId}/v/dc/${docId}`;

  return { doc_id: docId, doc_url: docUrl, title: resolvedTitle };
}

export async function createClickupDoc(
  clickup: ClickupApiEnv,
  input: ClickupDocCreateInput,
): Promise<ClickupDocCreateResult> {
  const attempts = buildDocCreateAttempts(input);
  if (attempts.length === 0) {
    throw new Error("ClickUp doc parent is not configured (space, folder, or list id required).");
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await createClickupDocOnce(clickup, input, attempt);
    } catch (e) {
      const message = (e as Error).message;
      errors.push(message);
      if (!isRetriableDocCreateError(message)) break;
    }
  }

  throw new Error(formatDocPermissionError(errors[errors.length - 1] ?? "ClickUp Doc API create failed."));
}

async function updateClickupDocPageContent(
  clickup: ClickupApiEnv,
  workspaceId: string,
  docId: string,
  pageId: string,
  title: string,
  markdown: string,
): Promise<void> {
  const response = await fetch(
    `${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: clickupAuthorizationHeader(clickup.apiToken),
      },
      body: JSON.stringify({
        name: title,
        content: markdown,
        content_edit_mode: "replace",
        content_format: "text/md",
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickUp page content update failed (${response.status}): ${text.slice(0, 800)}`);
  }
}

export async function recordClickupDocSource(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  doc: ClickupDocCreateResult;
  markdown: string;
}): Promise<string> {
  const { data: source, error } = await args.admin
    .from("project_knowledge_sources")
    .insert({
      project_id: args.projectId,
      source_type: "clickup_doc",
      source_title: args.doc.title,
      input_method: "api",
      external_provider: "clickup",
      external_id: args.doc.doc_id,
      source_text: args.markdown,
      source_preview: args.markdown.slice(0, 1000),
      metadata: { doc_url: args.doc.doc_url, created_by_agent: true },
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return source.id;
}

export async function recordTimelineDocEvent(args: {
  admin: SupabaseClient;
  projectId: string;
  title: string;
  docUrl: string;
  sourceId: string;
}): Promise<void> {
  await args.admin.from("project_timeline_events").insert({
    project_id: args.projectId,
    source_type: "clickup",
    source_table: "project_knowledge_sources",
    source_id: args.sourceId,
    event_type: "clickup_doc_created",
    event_title: args.title,
    event_summary: "ClickUp doc created by project agent",
    source_url: args.docUrl,
    metadata: { via: "agent" },
  });
}
