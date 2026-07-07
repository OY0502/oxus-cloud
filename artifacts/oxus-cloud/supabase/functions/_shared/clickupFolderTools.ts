import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { clickupAuthorizationHeader } from "./clickup.ts";
import type { ClickupApiEnv } from "./clickup.ts";

export async function executeCreateClickupFolder(args: {
  clickup: ClickupApiEnv;
  spaceId: string;
  name: string;
  parentFolderId?: string;
}): Promise<{ folder_id: string; name: string; url: string }> {
  const body: Record<string, unknown> = { name: args.name.trim() };
  const response = await fetch(`${args.clickup.baseUrl}/space/${args.spaceId}/folder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(args.clickup.apiToken),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp folder create failed (${response.status}): ${text.slice(0, 800)}`);
  }
  const folder = JSON.parse(text) as { id?: string; name?: string };
  const folderId = String(folder.id ?? "");
  if (!folderId) throw new Error("ClickUp folder create response missing id.");
  return {
    folder_id: folderId,
    name: folder.name ?? args.name,
    url: `https://app.clickup.com/${args.clickup.teamId}/v/f/${folderId}`,
  };
}

export async function executeRenameClickupFolder(args: {
  clickup: ClickupApiEnv;
  folderId: string;
  name: string;
}): Promise<{ folder_id: string; name: string }> {
  const response = await fetch(`${args.clickup.baseUrl}/folder/${args.folderId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(args.clickup.apiToken),
    },
    body: JSON.stringify({ name: args.name.trim() }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp folder rename failed (${response.status}): ${text.slice(0, 800)}`);
  }
  return { folder_id: args.folderId, name: args.name.trim() };
}

export async function executeArchiveClickupFolder(args: {
  clickup: ClickupApiEnv;
  folderId: string;
}): Promise<{ folder_id: string; archived: true }> {
  const response = await fetch(`${args.clickup.baseUrl}/folder/${args.folderId}`, {
    method: "DELETE",
    headers: { Authorization: clickupAuthorizationHeader(args.clickup.apiToken) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp folder archive failed (${response.status}): ${text.slice(0, 800)}`);
  }
  return { folder_id: args.folderId, archived: true };
}

export async function executeCreateClickupList(args: {
  clickup: ClickupApiEnv;
  folderId: string;
  name: string;
}): Promise<{ list_id: string; name: string; url: string }> {
  const response = await fetch(`${args.clickup.baseUrl}/folder/${args.folderId}/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(args.clickup.apiToken),
    },
    body: JSON.stringify({ name: args.name.trim() }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp list create failed (${response.status}): ${text.slice(0, 800)}`);
  }
  const list = JSON.parse(text) as { id?: string; name?: string };
  const listId = String(list.id ?? "");
  if (!listId) throw new Error("ClickUp list create response missing id.");
  return {
    list_id: listId,
    name: list.name ?? args.name,
    url: `https://app.clickup.com/${args.clickup.teamId}/v/li/${listId}`,
  };
}

export async function executeRenameClickupList(args: {
  clickup: ClickupApiEnv;
  listId: string;
  name: string;
}): Promise<{ list_id: string; name: string }> {
  const response = await fetch(`${args.clickup.baseUrl}/list/${args.listId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(args.clickup.apiToken),
    },
    body: JSON.stringify({ name: args.name.trim() }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp list rename failed (${response.status}): ${text.slice(0, 800)}`);
  }
  return { list_id: args.listId, name: args.name.trim() };
}

export async function executeMoveClickupTask(args: {
  clickup: ClickupApiEnv;
  taskId: string;
  listId: string;
}): Promise<{ task_id: string; list_id: string }> {
  const response = await fetch(`${args.clickup.baseUrl}/list/${args.listId}/task/${args.taskId}`, {
    method: "POST",
    headers: { Authorization: clickupAuthorizationHeader(args.clickup.apiToken) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp task move failed (${response.status}): ${text.slice(0, 800)}`);
  }
  return { task_id: args.taskId, list_id: args.listId };
}

export async function executeMoveClickupDoc(args: {
  clickup: ClickupApiEnv;
  workspaceId: string;
  docId: string;
  parent: { id: string; type: 4 | 5 | 6 };
}): Promise<{ doc_id: string; parent_id: string }> {
  const response = await fetch(
    `https://api.clickup.com/api/v3/workspaces/${args.workspaceId}/docs/${args.docId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: clickupAuthorizationHeader(args.clickup.apiToken),
      },
      body: JSON.stringify({ parent: args.parent }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp doc move failed (${response.status}): ${text.slice(0, 800)}`);
  }
  return { doc_id: args.docId, parent_id: args.parent.id };
}

export async function executeFolderManagementTool(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  toolName: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { resolveUserClickupForProject } = await import("./clickup-auth.ts");
  const { syncClickupProjectHierarchy } = await import("./clickupHierarchy.ts");
  const { clickup } = await resolveUserClickupForProject(args.userId, args.projectId);
  const { data: link } = await args.admin
    .from("project_clickup_links")
    .select("clickup_space_id, clickup_folder_id")
    .eq("project_id", args.projectId)
    .maybeSingle();
  const spaceId = String(link?.clickup_space_id ?? "").trim();
  if (!spaceId) throw new Error("Project ClickUp space is not linked.");

  let result: Record<string, unknown> = {};

  switch (args.toolName) {
    case "create_clickup_folder": {
      const name = String(args.payload.name ?? args.payload.folder_name ?? "").trim();
      if (!name) throw new Error("Folder name is required.");
      result = await executeCreateClickupFolder({ clickup, spaceId, name });
      break;
    }
    case "rename_clickup_folder": {
      const folderId = String(args.payload.folder_id ?? "").trim();
      const name = String(args.payload.name ?? args.payload.new_name ?? "").trim();
      if (!folderId || !name) throw new Error("folder_id and name are required.");
      result = await executeRenameClickupFolder({ clickup, folderId, name });
      break;
    }
    case "archive_clickup_folder": {
      const folderId = String(args.payload.folder_id ?? "").trim();
      if (!folderId) throw new Error("folder_id is required.");
      result = await executeArchiveClickupFolder({ clickup, folderId });
      break;
    }
    case "create_clickup_list": {
      const folderId = String(args.payload.folder_id ?? link?.clickup_folder_id ?? "").trim();
      const name = String(args.payload.name ?? args.payload.list_name ?? "").trim();
      if (!folderId || !name) throw new Error("folder_id and list name are required.");
      result = await executeCreateClickupList({ clickup, folderId, name });
      break;
    }
    case "rename_clickup_list": {
      const listId = String(args.payload.list_id ?? "").trim();
      const name = String(args.payload.name ?? args.payload.new_name ?? "").trim();
      if (!listId || !name) throw new Error("list_id and name are required.");
      result = await executeRenameClickupList({ clickup, listId, name });
      break;
    }
    case "move_clickup_task": {
      const taskId = String(args.payload.task_id ?? "").trim();
      const listId = String(args.payload.list_id ?? args.payload.destination_list_id ?? "").trim();
      if (!taskId || !listId) throw new Error("task_id and list_id are required.");
      result = await executeMoveClickupTask({ clickup, taskId, listId });
      break;
    }
    case "move_clickup_doc": {
      const docId = String(args.payload.doc_id ?? "").trim();
      const parentId = String(args.payload.parent_id ?? args.payload.destination_id ?? "").trim();
      const parentType = Number(args.payload.parent_type ?? 5) as 4 | 5 | 6;
      if (!docId || !parentId) throw new Error("doc_id and parent_id are required.");
      result = await executeMoveClickupDoc({
        clickup,
        workspaceId: clickup.teamId,
        docId,
        parent: { id: parentId, type: parentType },
      });
      break;
    }
    default:
      throw new Error(`Unsupported folder management tool: ${args.toolName}`);
  }

  await syncClickupProjectHierarchy({
    admin: args.admin,
    projectId: args.projectId,
    userId: args.userId,
    force: true,
  }).catch((e) => console.warn("[folder-tool] hierarchy refresh failed:", (e as Error).message));

  return result;
}
