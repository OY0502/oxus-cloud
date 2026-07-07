import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { clickupAuthorizationHeader } from "./clickup.ts";
import type { ClickupApiEnv } from "./clickup.ts";
import type { ClickupHierarchyRow } from "./clickupHierarchy.ts";
import { getClickupProjectHierarchy } from "./clickupHierarchy.ts";
import {
  buildClickupDocScope,
  classifyClickupDocScope,
  extractClickupDocParentId,
  sourceMatchesDocScope,
  type ClickupProjectLink,
  type DocScope,
} from "./clickupDocScope.ts";

const CLICKUP_V3_BASE = "https://api.clickup.com/api/v3";

export type ClickupDocSyncResult = {
  docs_checked: number;
  docs_imported: number;
  docs_updated: number;
  docs_skipped_unchanged: number;
  docs_skipped_out_of_scope: number;
  docs_marked_out_of_scope: number;
  docs_unknown_scope: number;
  active_clickup_docs: number;
  out_of_scope_clickup_docs: number;
  unknown_scope_clickup_docs: number;
  chunks_created: number;
  chunks_updated: number;
  chunks_deleted_or_replaced: number;
  memory_update_queued: boolean;
  embedding_queued: boolean;
  embedding_enabled?: boolean;
  retrieval_mode?: "vector" | "fallback";
  trigger_run_ids: string[];
  warnings: string[];
  source_ids: string[];
  changed_source_ids: string[];
  scope_parent: string;
  scope_mode: DocScope["mode"];
  message?: string;
};

export type { ClickupProjectLink };

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

async function fetchClickupDocPageContent(
  clickup: ClickupApiEnv,
  workspaceId: string,
  docId: string,
  pageId: string,
): Promise<string> {
  const response = await fetch(
    `${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs/${docId}/pages/${pageId}?content_format=text/md`,
    { headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) } },
  );
  const text = await response.text();
  if (!response.ok) return "";
  try {
    const parsed = JSON.parse(text) as { content?: string; name?: string };
    return String(parsed.content ?? "").trim();
  } catch {
    return "";
  }
}

async function fetchClickupDocMarkdown(
  clickup: ClickupApiEnv,
  workspaceId: string,
  docId: string,
  docTitle: string,
): Promise<string> {
  const pages = await listClickupDocPages(clickup, workspaceId, docId);
  if (pages.length === 0) return "";

  const parts: string[] = [];
  for (const page of pages.slice(0, 30)) {
    const content = await fetchClickupDocPageContent(clickup, workspaceId, docId, page.id);
    if (!content) continue;
    const heading = page.name && page.name !== docTitle ? `\n## ${page.name}\n` : "";
    parts.push(`${heading}${content}`.trim());
  }
  return parts.join("\n\n").trim();
}

async function fetchClickupWorkspaceDocs(
  clickup: ClickupApiEnv,
  workspaceId: string,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs?deleted=false&archived=false`,
    { headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) } },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp list docs failed (${response.status}): ${text.slice(0, 800)}`);
  }
  const parsed = JSON.parse(text) as { docs?: Record<string, unknown>[] };
  return Array.isArray(parsed.docs) ? parsed.docs : [];
}

function resolveDocParentLabel(
  doc: Record<string, unknown>,
  hierarchyRows: ClickupHierarchyRow[],
): string | null {
  const parent = doc.parent as { id?: string | number; type?: string | number } | undefined;
  if (!parent?.id) return null;
  const parentId = String(parent.id);
  const parentType = String(parent.type ?? "");
  const match = hierarchyRows.find((r) => r.external_id === parentId);
  if (match) return `${match.node_type} "${match.name}"`;
  if (parentType === "4") return `space ${parentId}`;
  if (parentType === "5") return `folder ${parentId}`;
  if (parentType === "6") return `list ${parentId}`;
  return parentId;
}

async function upsertDocChunks(args: {
  admin: SupabaseClient;
  projectId: string;
  sourceId: string;
  docTitle: string;
  markdown: string;
  isUpdate: boolean;
}): Promise<{ created: number; updated: number; deleted_or_replaced: number }> {
  const chunkSize = Number(Deno.env.get("AI_CHUNK_SIZE_CHARS") ?? "10000");
  const chunks = chunkText(args.markdown, chunkSize);
  if (chunks.length === 0) return { created: 0, updated: 0, deleted_or_replaced: 0 };

  let deletedOrReplaced = 0;
  if (args.isUpdate) {
    const { count } = await args.admin
      .from("project_knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("source_id", args.sourceId);
    deletedOrReplaced = count ?? 0;
    await args.admin.from("project_knowledge_chunks").delete().eq("source_id", args.sourceId);
  }

  const { error } = await args.admin.from("project_knowledge_chunks").insert(
    chunks.map((content, index) => ({
      project_id: args.projectId,
      source_id: args.sourceId,
      chunk_index: index,
      content,
      category: "clickup_doc",
      metadata: {
        source_type: "clickup_doc",
        doc_title: args.docTitle,
        char_count: content.length,
      },
    })),
  );
  if (error) throw new Error(error.message);

  return args.isUpdate
    ? { created: 0, updated: chunks.length, deleted_or_replaced: deletedOrReplaced }
    : { created: chunks.length, updated: 0, deleted_or_replaced: 0 };
}

async function countClickupDocSourcesByStatus(
  admin: SupabaseClient,
  projectId: string,
): Promise<{ active: number; out_of_scope: number; unknown_scope: number }> {
  const { data } = await admin
    .from("project_knowledge_sources")
    .select("sync_status")
    .eq("project_id", projectId)
    .eq("source_type", "clickup_doc")
    .eq("external_provider", "clickup");

  let active = 0;
  let out_of_scope = 0;
  let unknown_scope = 0;
  for (const row of data ?? []) {
    const status = String(row.sync_status ?? "active");
    if (status === "active") active += 1;
    else if (status === "out_of_scope") out_of_scope += 1;
    else if (status === "unknown_scope") unknown_scope += 1;
  }
  return { active, out_of_scope, unknown_scope };
}

async function markExistingClickupDocsOutOfScope(args: {
  admin: SupabaseClient;
  projectId: string;
  scope: DocScope;
  activeExternalIds: Set<string>;
}): Promise<number> {
  const { data: existing } = await args.admin
    .from("project_knowledge_sources")
    .select("id, external_id, metadata, sync_status")
    .eq("project_id", args.projectId)
    .eq("source_type", "clickup_doc")
    .eq("external_provider", "clickup")
    .in("sync_status", ["active", "unknown_scope"]);

  let marked = 0;
  for (const source of existing ?? []) {
    const externalId = String(source.external_id ?? "");
    if (externalId && args.activeExternalIds.has(externalId)) continue;

    const meta = (source.metadata ?? {}) as Record<string, unknown>;
    const classification = sourceMatchesDocScope(meta, args.scope);
    if (classification === "in_scope") continue;

    const { error } = await args.admin
      .from("project_knowledge_sources")
      .update({
        sync_status: classification === "unknown_scope" ? "unknown_scope" : "out_of_scope",
        metadata: {
          ...meta,
          out_of_scope_reason: "not_under_linked_clickup_project_hierarchy",
          marked_out_of_scope_at: new Date().toISOString(),
          scope_mode: args.scope.mode,
          scope_parent: args.scope.parentLabel,
        },
      })
      .eq("id", source.id);
    if (!error) marked += 1;
  }
  return marked;
}

export async function syncClickupDocsForProject(args: {
  admin: SupabaseClient;
  clickup: ClickupApiEnv;
  projectId: string;
  userId: string;
  link: ClickupProjectLink;
  syncAllWorkspaceDocs?: boolean;
}): Promise<ClickupDocSyncResult> {
  const warnings: string[] = [];
  const workspaceId = args.clickup.teamId;
  const spaceId = String(args.link.clickup_space_id ?? "").trim();
  if (!spaceId && !args.syncAllWorkspaceDocs) {
    throw new Error("Project ClickUp space is not configured.");
  }

  const hierarchy = await getClickupProjectHierarchy({
    admin: args.admin,
    projectId: args.projectId,
    userId: args.userId,
  });
  const scope = buildClickupDocScope({
    link: args.link,
    hierarchyRows: hierarchy.rows,
    syncAllWorkspaceDocs: args.syncAllWorkspaceDocs === true,
  });

  const docs = await fetchClickupWorkspaceDocs(args.clickup, workspaceId);

  let docsChecked = 0;
  let docsImported = 0;
  let docsUpdated = 0;
  let docsSkippedUnchanged = 0;
  let docsSkippedOutOfScope = 0;
  let docsUnknownScope = 0;
  let chunksCreated = 0;
  let chunksUpdated = 0;
  let chunksDeletedOrReplaced = 0;
  const sourceIds: string[] = [];
  const changedSourceIds: string[] = [];
  const activeExternalIds = new Set<string>();

  for (const doc of docs) {
    docsChecked += 1;
    const docId = String(doc.id ?? "");
    const name = String(doc.name ?? "ClickUp Doc");
    if (!docId) continue;

    const scopeClass = classifyClickupDocScope(doc, scope);
    if (scopeClass === "out_of_scope") {
      docsSkippedOutOfScope += 1;
      continue;
    }
    if (scopeClass === "unknown_scope") {
      docsUnknownScope += 1;
      warnings.push(`Doc "${name}" has no parent metadata — skipped (unknown scope).`);
      continue;
    }

    let markdown = "";
    try {
      markdown = await fetchClickupDocMarkdown(args.clickup, workspaceId, docId, name);
    } catch (e) {
      warnings.push(`Could not fetch content for "${name}": ${(e as Error).message}`);
      continue;
    }

    if (!markdown.trim()) {
      warnings.push(`Doc "${name}" has no readable page content — skipped.`);
      continue;
    }

    const contentHash = await sha256Hex(`${name}\n${markdown}`);
    const externalUpdatedAt = doc.date_updated != null ? String(doc.date_updated) : null;
    const parentLabel = resolveDocParentLabel(doc, hierarchy.rows);
    const parentId = extractClickupDocParentId({ clickup_doc: doc });
    const syncedAt = new Date().toISOString();

    const { data: existing } = await args.admin
      .from("project_knowledge_sources")
      .select("id, source_title, metadata, sync_status")
      .eq("project_id", args.projectId)
      .eq("external_provider", "clickup")
      .eq("external_id", docId)
      .maybeSingle();

    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const existingHash = typeof existingMeta.content_hash === "string" ? existingMeta.content_hash : null;
    const existingTitle = existing?.source_title ?? null;

    const titleChanged = existingTitle != null && existingTitle !== name;
    const hashChanged = existingHash !== contentHash;

    if (existing?.id) {
      activeExternalIds.add(docId);
      sourceIds.push(existing.id);

      if (!hashChanged && !titleChanged) {
        docsSkippedUnchanged += 1;
        await args.admin
          .from("project_knowledge_sources")
          .update({ sync_status: "active", last_synced_at: syncedAt })
          .eq("id", existing.id);
        continue;
      }

      const { error: updateError } = await args.admin
        .from("project_knowledge_sources")
        .update({
          source_title: name,
          char_count: markdown.length,
          source_text: markdown,
          source_preview: markdown.slice(0, 1000),
          sync_status: "active",
          last_synced_at: syncedAt,
          metadata: {
            ...existingMeta,
            clickup_doc: doc,
            content_hash: contentHash,
            external_updated_at: externalUpdatedAt,
            synced_at: syncedAt,
            clickup_parent: parentLabel,
            clickup_parent_id: parentId,
            scope_mode: scope.mode,
            scope_parent: scope.parentLabel,
            content_changed: true,
          },
        })
        .eq("id", existing.id);
      if (updateError) {
        warnings.push(`Update failed for "${name}": ${updateError.message}`);
        continue;
      }

      const chunkResult = await upsertDocChunks({
        admin: args.admin,
        projectId: args.projectId,
        sourceId: existing.id,
        docTitle: name,
        markdown,
        isUpdate: true,
      });
      chunksUpdated += chunkResult.updated;
      chunksDeletedOrReplaced += chunkResult.deleted_or_replaced;
      docsUpdated += 1;
      sourceIds.push(existing.id);
      changedSourceIds.push(existing.id);
      continue;
    }

    const { data: source, error: insertError } = await args.admin
      .from("project_knowledge_sources")
      .insert({
        project_id: args.projectId,
        source_type: "clickup_doc",
        source_title: name,
        input_method: "api",
        external_provider: "clickup",
        external_id: docId,
        char_count: markdown.length,
        source_text: markdown,
        source_preview: markdown.slice(0, 1000),
        sync_status: "active",
        last_synced_at: syncedAt,
        metadata: {
          clickup_doc: doc,
          doc_url: typeof doc.url === "string" ? doc.url : `https://app.clickup.com/${workspaceId}/v/dc/${docId}`,
          content_hash: contentHash,
          external_updated_at: externalUpdatedAt,
          synced_at: syncedAt,
          clickup_parent: parentLabel,
          clickup_parent_id: parentId,
          scope_mode: scope.mode,
          scope_parent: scope.parentLabel,
        },
        created_by: args.userId,
      })
      .select("id")
      .single();
    if (insertError) {
      warnings.push(`Insert failed for "${name}": ${insertError.message}`);
      continue;
    }

    activeExternalIds.add(docId);
    const chunkResult = await upsertDocChunks({
      admin: args.admin,
      projectId: args.projectId,
      sourceId: source.id,
      docTitle: name,
      markdown,
      isUpdate: false,
    });
    chunksCreated += chunkResult.created;
    docsImported += 1;
    sourceIds.push(source.id);
    changedSourceIds.push(source.id);
  }

  const docsMarkedOutOfScope = await markExistingClickupDocsOutOfScope({
    admin: args.admin,
    projectId: args.projectId,
    scope,
    activeExternalIds,
  });

  const statusCounts = await countClickupDocSourcesByStatus(args.admin, args.projectId);

  const hasChanges = docsImported + docsUpdated > 0;
  const message = hasChanges
    ? undefined
    : "No ClickUp document content changes detected. Project memory was not updated.";

  if (docsUnknownScope > 0) {
    warnings.push(`${docsUnknownScope} doc(s) skipped due to unknown parent scope.`);
  }
  if (docsMarkedOutOfScope > 0) {
    warnings.push(`${docsMarkedOutOfScope} previously imported doc(s) marked out of scope.`);
  }

  return {
    docs_checked: docsChecked,
    docs_imported: docsImported,
    docs_updated: docsUpdated,
    docs_skipped_unchanged: docsSkippedUnchanged,
    docs_skipped_out_of_scope: docsSkippedOutOfScope,
    docs_marked_out_of_scope: docsMarkedOutOfScope,
    docs_unknown_scope: docsUnknownScope,
    active_clickup_docs: statusCounts.active,
    out_of_scope_clickup_docs: statusCounts.out_of_scope,
    unknown_scope_clickup_docs: statusCounts.unknown_scope,
    chunks_created: chunksCreated,
    chunks_updated: chunksUpdated,
    chunks_deleted_or_replaced: chunksDeletedOrReplaced,
    memory_update_queued: false,
    embedding_queued: false,
    trigger_run_ids: [],
    warnings,
    source_ids: sourceIds,
    changed_source_ids: changedSourceIds,
    scope_parent: scope.parentLabel,
    scope_mode: scope.mode,
    message,
  };
}

export async function recordClickupDocsSyncTimelineEvent(args: {
  admin: SupabaseClient;
  projectId: string;
  result: ClickupDocSyncResult;
}): Promise<void> {
  if (args.result.docs_imported + args.result.docs_updated === 0 && args.result.docs_marked_out_of_scope === 0) {
    return;
  }

  await args.admin.from("project_timeline_events").insert({
    project_id: args.projectId,
    source_type: "clickup",
    source_table: "project_knowledge_sources",
    event_type: "clickup_docs_synced",
    event_title: "ClickUp docs synced",
    event_summary: `${args.result.docs_imported} imported, ${args.result.docs_updated} updated, ${args.result.docs_marked_out_of_scope} marked out of scope (${args.result.scope_mode}: ${args.result.scope_parent})`,
    metadata: {
      docs_checked: args.result.docs_checked,
      docs_imported: args.result.docs_imported,
      docs_updated: args.result.docs_updated,
      docs_skipped_unchanged: args.result.docs_skipped_unchanged,
      docs_skipped_out_of_scope: args.result.docs_skipped_out_of_scope,
      docs_marked_out_of_scope: args.result.docs_marked_out_of_scope,
      active_clickup_docs: args.result.active_clickup_docs,
      scope_parent: args.result.scope_parent,
      scope_mode: args.result.scope_mode,
    },
  });
}
