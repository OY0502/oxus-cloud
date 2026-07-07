import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveUserClickupForProject } from "./clickup-auth.ts";
import { clickupAuthorizationHeader } from "./clickup.ts";
import type { ClickupApiEnv } from "./clickup.ts";
import { buildClickupDocScope } from "./clickupDocScope.ts";

const CLICKUP_V3_BASE = "https://api.clickup.com/api/v3";
const HIERARCHY_STALE_MS = 15 * 60 * 1000;

export type ClickupHierarchyNodeType =
  | "workspace"
  | "space"
  | "folder"
  | "list"
  | "doc"
  | "doc_page";

export type ClickupHierarchyRow = {
  project_id: string;
  team_id?: string | null;
  space_id?: string | null;
  folder_id?: string | null;
  list_id?: string | null;
  node_type: ClickupHierarchyNodeType;
  external_id: string;
  parent_external_id?: string | null;
  name: string;
  url?: string | null;
  metadata?: Record<string, unknown>;
  external_updated_at?: string | null;
  last_synced_at?: string;
};

export type ClickupDestination = {
  type: "workspace" | "space" | "folder" | "list";
  id: string;
  name: string;
  path: string;
  reason: string;
};

export type ClickupHierarchySummary = {
  folders: number;
  lists: number;
  docs: number;
  pages: number;
  last_synced_at: string | null;
};

export type SyncClickupHierarchyResult = {
  folders_synced: number;
  lists_synced: number;
  docs_synced: number;
  pages_synced: number;
  warnings: string[];
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function flattenDocPages(pages: unknown[]): Array<{ id: string; name?: string; parent_id?: string }> {
  const out: Array<{ id: string; name?: string; parent_id?: string }> = [];
  for (const entry of pages) {
    if (!entry || typeof entry !== "object") continue;
    const page = entry as Record<string, unknown>;
    if (page.id != null) {
      out.push({
        id: String(page.id),
        name: typeof page.name === "string" ? page.name : undefined,
        parent_id: page.parent_page_id != null ? String(page.parent_page_id) : undefined,
      });
    }
    if (Array.isArray(page.pages)) out.push(...flattenDocPages(page.pages));
  }
  return out;
}

async function fetchClickupDocs(
  clickup: ClickupApiEnv,
  workspaceId: string,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs?deleted=false&archived=false`,
    { headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) } },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp list docs failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const parsed = JSON.parse(text) as { docs?: Record<string, unknown>[] };
  return Array.isArray(parsed.docs) ? parsed.docs : [];
}

async function fetchClickupDocPages(
  clickup: ClickupApiEnv,
  workspaceId: string,
  docId: string,
): Promise<Array<{ id: string; name?: string; parent_id?: string }>> {
  try {
    const response = await fetch(
      `${CLICKUP_V3_BASE}/workspaces/${workspaceId}/docs/${docId}/pages?max_page_depth=-1`,
      { headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) } },
    );
    const text = await response.text();
    if (!response.ok) return [];
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return flattenDocPages(parsed);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.pages)) return flattenDocPages(record.pages);
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchClickupHierarchyFromApi(args: {
  clickup: ClickupApiEnv;
  projectId: string;
  spaceId: string;
  linkedFolderId?: string | null;
  linkedListId?: string | null;
  includeDocPages?: boolean;
}): Promise<{ rows: ClickupHierarchyRow[]; warnings: string[] }> {
  const { clickup, projectId, spaceId } = args;
  const teamId = clickup.teamId;
  const rows: ClickupHierarchyRow[] = [];
  const warnings: string[] = [];
  const syncedAt = new Date().toISOString();

  rows.push({
    project_id: projectId,
    team_id: teamId,
    node_type: "workspace",
    external_id: teamId,
    parent_external_id: null,
    name: `Workspace ${teamId}`,
    url: `https://app.clickup.com/${teamId}`,
    last_synced_at: syncedAt,
  });

  let spaceName = `Space ${spaceId}`;
  try {
    const spaceResp = await fetch(`${clickup.baseUrl}/space/${spaceId}`, {
      headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) },
    });
    if (spaceResp.ok) {
      const space = await spaceResp.json() as { name?: string };
      if (space.name) spaceName = space.name;
    }
  } catch {
    warnings.push("Could not fetch space details.");
  }

  rows.push({
    project_id: projectId,
    team_id: teamId,
    space_id: spaceId,
    node_type: "space",
    external_id: spaceId,
    parent_external_id: teamId,
    name: spaceName,
    url: `https://app.clickup.com/${teamId}/v/s/${spaceId}`,
    last_synced_at: syncedAt,
  });

  const foldersResp = await fetch(`${clickup.baseUrl}/space/${spaceId}/folder?archived=false`, {
    headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) },
  });
  const foldersText = await foldersResp.text();
  if (!foldersResp.ok) {
    throw new Error(`ClickUp list folders failed (${foldersResp.status}): ${foldersText.slice(0, 400)}`);
  }
  const foldersParsed = JSON.parse(foldersText) as { folders?: Record<string, unknown>[] };
  const folders = Array.isArray(foldersParsed.folders) ? foldersParsed.folders : [];

  for (const folder of folders) {
    const folderId = String(folder.id ?? "");
    if (!folderId) continue;
    const folderName = String(folder.name ?? `Folder ${folderId}`);
    rows.push({
      project_id: projectId,
      team_id: teamId,
      space_id: spaceId,
      folder_id: folderId,
      node_type: "folder",
      external_id: folderId,
      parent_external_id: spaceId,
      name: folderName,
      url: `https://app.clickup.com/${teamId}/v/f/${folderId}`,
      metadata: { archived: folder.archived ?? false },
      last_synced_at: syncedAt,
    });

    try {
      const listsResp = await fetch(`${clickup.baseUrl}/folder/${folderId}/list?archived=false`, {
        headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) },
      });
      if (listsResp.ok) {
        const listsParsed = await listsResp.json() as { lists?: Record<string, unknown>[] };
        const lists = Array.isArray(listsParsed.lists) ? listsParsed.lists : [];
        for (const list of lists) {
          const listId = String(list.id ?? "");
          if (!listId) continue;
          rows.push({
            project_id: projectId,
            team_id: teamId,
            space_id: spaceId,
            folder_id: folderId,
            list_id: listId,
            node_type: "list",
            external_id: listId,
            parent_external_id: folderId,
            name: String(list.name ?? `List ${listId}`),
            url: `https://app.clickup.com/${teamId}/v/li/${listId}`,
            metadata: { folder_name: folderName },
            last_synced_at: syncedAt,
          });
        }
      }
    } catch (e) {
      warnings.push(`Could not list lists in folder ${folderName}: ${(e as Error).message}`);
    }
  }

  try {
    const folderlessResp = await fetch(`${clickup.baseUrl}/space/${spaceId}/list?archived=false`, {
      headers: { Authorization: clickupAuthorizationHeader(clickup.apiToken) },
    });
    if (folderlessResp.ok) {
      const folderlessParsed = await folderlessResp.json() as { lists?: Record<string, unknown>[] };
      const lists = Array.isArray(folderlessParsed.lists) ? folderlessParsed.lists : [];
      for (const list of lists) {
        const listId = String(list.id ?? "");
        if (!listId) continue;
        rows.push({
          project_id: projectId,
          team_id: teamId,
          space_id: spaceId,
          list_id: listId,
          node_type: "list",
          external_id: listId,
          parent_external_id: spaceId,
          name: String(list.name ?? `List ${listId}`),
          url: `https://app.clickup.com/${teamId}/v/li/${listId}`,
          metadata: { folderless: true },
          last_synced_at: syncedAt,
        });
      }
    }
  } catch (e) {
    warnings.push(`Could not list folderless lists: ${(e as Error).message}`);
  }

  try {
    const docs = await fetchClickupDocs(clickup, teamId);
    const docScope = buildClickupDocScope({
      link: {
        clickup_space_id: spaceId,
        clickup_folder_id: args.linkedFolderId,
        clickup_list_id: args.linkedListId,
      },
      hierarchyRows: rows,
      syncAllWorkspaceDocs: false,
    });

    for (const doc of docs) {
      const docId = String(doc.id ?? "");
      if (!docId) continue;
      const parent = doc.parent as Record<string, unknown> | undefined;
      const parentId = parent?.id != null ? String(parent.id) : null;
      if (docScope.allowedParentIds && parentId && !docScope.allowedParentIds.has(parentId)) continue;
      if (docScope.allowedParentIds && !parentId) continue;

      const docName = String(doc.name ?? `Doc ${docId}`);
      const parentType = parent?.type != null ? String(parent.type) : "4";
      const resolvedParentId = parentId ?? spaceId;

      rows.push({
        project_id: projectId,
        team_id: teamId,
        space_id: spaceId,
        folder_id: parentType === "5" ? parentId : undefined,
        list_id: parentType === "6" ? parentId : undefined,
        node_type: "doc",
        external_id: docId,
        parent_external_id: resolvedParentId,
        name: docName,
        url: typeof doc.url === "string"
          ? doc.url
          : `https://app.clickup.com/${teamId}/v/dc/${docId}`,
        metadata: { parent_type: parentType },
        last_synced_at: syncedAt,
      });

      if (args.includeDocPages !== false) {
        const pages = await fetchClickupDocPages(clickup, teamId, docId);
        for (const page of pages.slice(0, 20)) {
          rows.push({
            project_id: projectId,
            team_id: teamId,
            space_id: spaceId,
            node_type: "doc_page",
            external_id: page.id,
            parent_external_id: docId,
            name: page.name ?? "Page",
            metadata: { doc_id: docId, parent_page_id: page.parent_id },
            last_synced_at: syncedAt,
          });
        }
      }
    }
  } catch (e) {
    warnings.push(`Could not list docs: ${(e as Error).message}`);
  }

  return { rows, warnings };
}

export async function upsertHierarchyCache(
  admin: SupabaseClient,
  rows: ClickupHierarchyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const projectId = rows[0].project_id;

  const { error: deleteError } = await admin
    .from("project_clickup_hierarchy_cache")
    .delete()
    .eq("project_id", projectId);
  if (deleteError) throw new Error(deleteError.message);

  const { error } = await admin
    .from("project_clickup_hierarchy_cache")
    .insert(
      rows.map((row) => ({
        project_id: row.project_id,
        team_id: row.team_id ?? null,
        space_id: row.space_id ?? null,
        folder_id: row.folder_id ?? null,
        list_id: row.list_id ?? null,
        node_type: row.node_type,
        external_id: row.external_id,
        parent_external_id: row.parent_external_id ?? null,
        name: row.name,
        url: row.url ?? null,
        metadata: row.metadata ?? {},
        external_updated_at: row.external_updated_at ?? null,
        last_synced_at: row.last_synced_at ?? new Date().toISOString(),
      })),
    );
  if (error) throw new Error(error.message);
}

export async function getClickupProjectHierarchy(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
}): Promise<{
  rows: ClickupHierarchyRow[];
  summary: ClickupHierarchySummary;
  link: Record<string, unknown> | null;
}> {
  const { data: link } = await args.admin
    .from("project_clickup_links")
    .select("*")
    .eq("project_id", args.projectId)
    .maybeSingle();

  const { data: cached } = await args.admin
    .from("project_clickup_hierarchy_cache")
    .select("*")
    .eq("project_id", args.projectId)
    .order("node_type")
    .order("name");

  const rows = (cached ?? []) as ClickupHierarchyRow[];
  const lastSynced = rows.reduce<string | null>((latest, row) => {
    const ts = row.last_synced_at ?? null;
    if (!ts) return latest;
    if (!latest || ts > latest) return ts;
    return latest;
  }, null);

  return {
    rows,
    summary: {
      folders: rows.filter((r) => r.node_type === "folder").length,
      lists: rows.filter((r) => r.node_type === "list").length,
      docs: rows.filter((r) => r.node_type === "doc").length,
      pages: rows.filter((r) => r.node_type === "doc_page").length,
      last_synced_at: lastSynced,
    },
    link: link as Record<string, unknown> | null,
  };
}

export async function syncClickupProjectHierarchy(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  force?: boolean;
}): Promise<SyncClickupHierarchyResult> {
  const { clickup } = await resolveUserClickupForProject(args.userId, args.projectId);
  const { data: link } = await args.admin
    .from("project_clickup_links")
    .select("clickup_space_id, clickup_folder_id, clickup_list_id")
    .eq("project_id", args.projectId)
    .maybeSingle();

  const spaceId = String(link?.clickup_space_id ?? "").trim();
  if (!spaceId) throw new Error("Project ClickUp space is not linked.");

  if (!args.force) {
    const { data: recent } = await args.admin
      .from("project_clickup_hierarchy_cache")
      .select("last_synced_at")
      .eq("project_id", args.projectId)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.last_synced_at) {
      const age = Date.now() - new Date(recent.last_synced_at).getTime();
      if (age < HIERARCHY_STALE_MS) {
        const existing = await getClickupProjectHierarchy(args);
        return {
          folders_synced: existing.summary.folders,
          lists_synced: existing.summary.lists,
          docs_synced: existing.summary.docs,
          pages_synced: existing.summary.pages,
          warnings: ["Used cached hierarchy (synced recently)."],
        };
      }
    }
  }

  const { rows, warnings } = await fetchClickupHierarchyFromApi({
    clickup,
    projectId: args.projectId,
    spaceId,
    linkedFolderId: link?.clickup_folder_id,
    linkedListId: link?.clickup_list_id,
  });

  await upsertHierarchyCache(args.admin, rows);

  return {
    folders_synced: rows.filter((r) => r.node_type === "folder").length,
    lists_synced: rows.filter((r) => r.node_type === "list").length,
    docs_synced: rows.filter((r) => r.node_type === "doc").length,
    pages_synced: rows.filter((r) => r.node_type === "doc_page").length,
    warnings,
  };
}

export function buildHierarchyContextBlock(rows: ClickupHierarchyRow[], link?: Record<string, unknown> | null): string {
  const folders = rows.filter((r) => r.node_type === "folder");
  const lists = rows.filter((r) => r.node_type === "list");
  const docs = rows.filter((r) => r.node_type === "doc").slice(0, 30);

  const parts: string[] = ["ClickUp hierarchy (existing structure — do NOT create folders unless user explicitly asks):"];

  if (link) {
    parts.push(
      `Project-linked ClickUp: space=${link.space_name ?? link.clickup_space_id}, folder=${link.folder_name ?? link.clickup_folder_id ?? "none"}, list=${link.list_name ?? link.clickup_list_id ?? "none"}`,
    );
  }

  if (folders.length > 0) {
    parts.push(`Folders:\n${folders.map((f) => `- ${f.name} (id=${f.external_id})`).join("\n")}`);
  }
  if (lists.length > 0) {
    parts.push(
      `Lists:\n${lists.map((l) => {
        const folderName = (l.metadata as Record<string, unknown>)?.folder_name;
        return `- ${l.name}${folderName ? ` in ${folderName}` : ""} (id=${l.external_id})`;
      }).join("\n")}`,
    );
  }
  if (docs.length > 0) {
    parts.push(`Existing docs (avoid duplicates):\n${docs.map((d) => `- ${d.name} (id=${d.external_id})`).join("\n")}`);
  }

  return parts.join("\n\n");
}

const DOC_INTENT_FOLDERS = ["delivery", "research", "design", "qa", "estimates", "credentials", "scope", "docs", "documentation"];
const TASK_INTENT_LISTS = ["tasks", "delivery", "qa", "design", "backlog", "sprint"];

function scoreNameMatch(name: string, keywords: string[]): number {
  const normalized = normalizeName(name);
  let score = 0;
  for (const kw of keywords) {
    if (normalized === kw) score += 10;
    else if (normalized.includes(kw)) score += 5;
  }
  return score;
}

export function suggestDocDestination(args: {
  rows: ClickupHierarchyRow[];
  link?: Record<string, unknown> | null;
  requestText?: string;
  docTitle?: string;
}): ClickupDestination {
  const folders = args.rows.filter((r) => r.node_type === "folder");
  const linkedFolderId = String(args.link?.clickup_folder_id ?? "");
  const linkedFolderName = String(args.link?.folder_name ?? "");
  const spaceId = String(args.link?.clickup_space_id ?? "");
  const spaceName = String(args.link?.space_name ?? "Project space");

  const requestLower = normalizeName(`${args.requestText ?? ""} ${args.docTitle ?? ""}`);
  const intentKeywords = DOC_INTENT_FOLDERS.filter((kw) => requestLower.includes(kw));

  let bestFolder = folders.find((f) => f.external_id === linkedFolderId);
  let bestScore = bestFolder ? 20 : 0;
  let reason = linkedFolderName
    ? `Default project-linked folder "${linkedFolderName}".`
    : "Default project-linked ClickUp space.";

  for (const folder of folders) {
    const score = scoreNameMatch(folder.name, intentKeywords.length > 0 ? intentKeywords : ["delivery", "docs"]);
    if (linkedFolderId && folder.external_id === linkedFolderId) {
      if (score + 20 > bestScore) {
        bestFolder = folder;
        bestScore = score + 20;
        reason = `Project-linked folder "${folder.name}" matches doc placement policy.`;
      }
    } else if (score > bestScore) {
      bestFolder = folder;
      bestScore = score;
      reason = `Folder "${folder.name}" best matches document intent.`;
    }
  }

  if (bestFolder) {
    return {
      type: "folder",
      id: bestFolder.external_id,
      name: bestFolder.name,
      path: `${spaceName} / ${bestFolder.name}`,
      reason,
    };
  }

  return {
    type: "space",
    id: spaceId,
    name: spaceName,
    path: spaceName,
    reason: "No matching folder found; using project space as doc parent.",
  };
}

export function suggestTaskDestination(args: {
  rows: ClickupHierarchyRow[];
  link?: Record<string, unknown> | null;
  requestText?: string;
  taskTitle?: string;
}): ClickupDestination {
  const lists = args.rows.filter((r) => r.node_type === "list");
  const linkedListId = String(args.link?.clickup_list_id ?? "");
  const linkedListName = String(args.link?.list_name ?? "");
  const linkedFolderName = String(args.link?.folder_name ?? "");

  const requestLower = normalizeName(`${args.requestText ?? ""} ${args.taskTitle ?? ""}`);
  const intentKeywords = TASK_INTENT_LISTS.filter((kw) => requestLower.includes(kw));

  let bestList = lists.find((l) => l.external_id === linkedListId);
  let bestScore = bestList ? 25 : 0;
  let reason = linkedListName
    ? `Project-linked list "${linkedListName}" in ${linkedFolderName || "space"}.`
    : "Best available list in ClickUp hierarchy.";

  for (const list of lists) {
    const score = scoreNameMatch(list.name, intentKeywords.length > 0 ? intentKeywords : ["tasks", "delivery"]);
    if (linkedListId && list.external_id === linkedListId) {
      if (score + 25 > bestScore) {
        bestList = list;
        bestScore = score + 25;
        reason = `Project-linked list "${list.name}" is the default task destination.`;
      }
    } else if (score > bestScore) {
      bestList = list;
      bestScore = score;
      const folderName = (list.metadata as Record<string, unknown>)?.folder_name;
      reason = folderName
        ? `List "${list.name}" in folder "${folderName}" matches task intent.`
        : `List "${list.name}" matches task intent.`;
    }
  }

  if (bestList) {
    const folderName = (bestList.metadata as Record<string, unknown>)?.folder_name;
    return {
      type: "list",
      id: bestList.external_id,
      name: bestList.name,
      path: folderName ? `${folderName} / ${bestList.name}` : bestList.name,
      reason,
    };
  }

  return {
    type: "list",
    id: linkedListId,
    name: linkedListName || "Tasks",
    path: linkedFolderName ? `${linkedFolderName} / ${linkedListName}` : linkedListName,
    reason: "Using project-linked list as fallback.",
  };
}

export async function ensureHierarchyFreshForTools(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
}): Promise<{ rows: ClickupHierarchyRow[]; summary: ClickupHierarchySummary; syncWarnings: string[] }> {
  try {
    const sync = await syncClickupProjectHierarchy({ ...args, force: false });
    const hierarchy = await getClickupProjectHierarchy(args);
    return { ...hierarchy, syncWarnings: sync.warnings };
  } catch (e) {
    const hierarchy = await getClickupProjectHierarchy(args);
    return {
      ...hierarchy,
      syncWarnings: [`Hierarchy sync skipped: ${(e as Error).message}`],
    };
  }
}

export function findSimilarDoc(rows: ClickupHierarchyRow[], title: string): ClickupHierarchyRow | undefined {
  const normalized = normalizeName(title);
  return rows
    .filter((r) => r.node_type === "doc")
    .find((d) => normalizeName(d.name) === normalized || normalizeName(d.name).includes(normalized));
}
