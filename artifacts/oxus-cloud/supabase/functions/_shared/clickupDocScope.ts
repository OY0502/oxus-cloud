import type { ClickupHierarchyRow } from "./clickupHierarchy.ts";

export type ClickupProjectLink = {
  clickup_space_id?: string | null;
  clickup_folder_id?: string | null;
  clickup_list_id?: string | null;
  space_name?: string | null;
  folder_name?: string | null;
  list_name?: string | null;
};

export type DocScopeMode = "list" | "folder" | "space" | "workspace";

export type DocScope = {
  mode: DocScopeMode;
  allowedParentIds: Set<string> | null;
  parentLabel: string;
  spaceId: string;
  folderId: string;
  listId: string;
};

export type DocScopeClassification = "in_scope" | "out_of_scope" | "unknown_scope";

export function buildClickupDocScope(args: {
  link: ClickupProjectLink;
  hierarchyRows: ClickupHierarchyRow[];
  syncAllWorkspaceDocs?: boolean;
}): DocScope {
  const spaceId = String(args.link.clickup_space_id ?? "").trim();
  const folderId = String(args.link.clickup_folder_id ?? "").trim();
  const listId = String(args.link.clickup_list_id ?? "").trim();

  if (args.syncAllWorkspaceDocs) {
    return {
      mode: "workspace",
      allowedParentIds: null,
      parentLabel: "entire workspace",
      spaceId,
      folderId,
      listId,
    };
  }

  const foldersInSpace = args.hierarchyRows
    .filter((r) => r.node_type === "folder" && (!spaceId || r.space_id === spaceId))
    .map((r) => r.external_id);
  const listsInFolder = folderId
    ? args.hierarchyRows
      .filter((r) => r.node_type === "list" && r.folder_id === folderId)
      .map((r) => r.external_id)
    : [];
  const listsInSpace = args.hierarchyRows
    .filter((r) => r.node_type === "list" && (!spaceId || r.space_id === spaceId))
    .map((r) => r.external_id);

  const allowed = new Set<string>();
  if (spaceId) allowed.add(spaceId);
  if (folderId) {
    allowed.add(folderId);
    for (const id of listsInFolder) allowed.add(id);
  }
  if (listId) allowed.add(listId);

  const spaceName = args.link.space_name ?? spaceId;
  const folderName = args.link.folder_name ?? folderId;
  const listName = args.link.list_name ?? listId;

  if (listId && folderId) {
    return {
      mode: "list",
      allowedParentIds: allowed,
      parentLabel: `folder "${folderName}" → list "${listName}"`,
      spaceId,
      folderId,
      listId,
    };
  }

  if (folderId) {
    return {
      mode: "folder",
      allowedParentIds: allowed,
      parentLabel: `folder "${folderName}" (${folderId})`,
      spaceId,
      folderId,
      listId,
    };
  }

  if (spaceId) {
    for (const id of foldersInSpace) allowed.add(id);
    for (const id of listsInSpace) allowed.add(id);
    return {
      mode: "space",
      allowedParentIds: allowed,
      parentLabel: `space "${spaceName}" (${spaceId})`,
      spaceId,
      folderId,
      listId,
    };
  }

  return {
    mode: "workspace",
    allowedParentIds: null,
    parentLabel: "entire workspace (no link configured)",
    spaceId,
    folderId,
    listId,
  };
}

export function classifyClickupDocScope(
  doc: Record<string, unknown>,
  scope: DocScope,
): DocScopeClassification {
  if (!scope.allowedParentIds) return "in_scope";
  const parent = doc.parent as { id?: string | number; type?: string | number } | undefined;
  if (parent?.id == null) return "unknown_scope";
  return scope.allowedParentIds.has(String(parent.id)) ? "in_scope" : "out_of_scope";
}

export function extractClickupDocParentId(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const clickupDoc = metadata.clickup_doc as Record<string, unknown> | undefined;
  const parent = clickupDoc?.parent as { id?: string | number } | undefined;
  if (parent?.id != null) return String(parent.id);
  const direct = metadata.clickup_parent_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return null;
}

export function sourceMatchesDocScope(
  metadata: Record<string, unknown> | null | undefined,
  scope: DocScope,
): DocScopeClassification {
  if (!scope.allowedParentIds) return "in_scope";
  const parentId = extractClickupDocParentId(metadata);
  if (!parentId) return "unknown_scope";
  return scope.allowedParentIds.has(parentId) ? "in_scope" : "out_of_scope";
}
