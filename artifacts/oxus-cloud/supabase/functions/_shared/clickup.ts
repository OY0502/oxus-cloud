/** Shared ClickUp API helpers for Supabase Edge Functions. */

export const CLICKUP_WEBHOOK_EVENTS = [
  "taskCommentPosted",
  "taskCommentUpdated",
  "taskUpdated",
  "taskStatusUpdated",
  "taskAssigneeUpdated",
  "taskDueDateUpdated",
  "taskPriorityUpdated",
] as const;

export type ClickupErrorCode =
  | "CONFIG_ERROR"
  | "CLICKUP_ERROR"
  | "DB_ERROR"
  | "NOT_FOUND"
  | "UNEXPECTED_ERROR";

export type ClickupApiEnv = {
  apiToken: string;
  teamId: string;
  baseUrl: string;
};

/** @deprecated Legacy shared token path — user-triggered flows use per-user OAuth instead. */
export function getClickupEnv(): ClickupApiEnv | null {
  const apiToken = Deno.env.get("CLICKUP_API_TOKEN")?.trim();
  const teamId = Deno.env.get("CLICKUP_TEAM_ID")?.trim();
  const baseUrl = (Deno.env.get("CLICKUP_API_BASE_URL") ?? "https://api.clickup.com/api/v2").replace(/\/+$/, "");
  if (!apiToken || !teamId) return null;
  return { apiToken, teamId, baseUrl };
}

export function clickupAuthorizationHeader(apiToken: string): string {
  const trimmed = apiToken.trim();
  if (trimmed.startsWith("pk_") || trimmed.toLowerCase().startsWith("bearer ")) return trimmed;
  return `Bearer ${trimmed}`;
}

export async function clickupFetch(
  env: { apiToken: string; baseUrl: string },
  path: string,
  options?: RequestInit,
): Promise<any> {
  const url = `${env.baseUrl}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: clickupAuthorizationHeader(env.apiToken),
      ...(options?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`ClickUp API ${options?.method ?? "GET"} ${path} failed: status=${resp.status}; ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ClickUp API ${path} returned non-JSON: ${text.slice(0, 400)}`);
  }
}

// Map OXUS priority string → ClickUp priority integer (or undefined for default).
// ClickUp fixed scale: 1=Urgent, 2=High, 3=Normal, 4=Low.
export function oxusPriorityToClickup(priority: string | null | undefined): number | undefined {
  switch (priority) {
    case "urgent": return 1;
    case "high":   return 2;
    case "medium": return 3;
    case "low":    return 4;
    default:       return undefined;
  }
}

/** ClickUp's fixed, non-list-specific priority options for UI dropdowns. */
export const CLICKUP_PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent", clickup_value: 1 },
  { value: "high", label: "High", clickup_value: 2 },
  { value: "medium", label: "Normal", clickup_value: 3 },
  { value: "low", label: "Low", clickup_value: 4 },
] as const;

export type ClickupListStatus = {
  status: string;
  type?: string;
  orderindex?: number;
  color?: string;
};

/** Fetch the ordered list of available statuses for a ClickUp list. */
export async function fetchListStatuses(
  clickup: { apiToken: string; baseUrl: string },
  listId: string,
): Promise<ClickupListStatus[]> {
  const list = await clickupFetch(clickup, `/list/${listId}`);
  const statuses = list?.statuses;
  if (!Array.isArray(statuses)) return [];
  return [...statuses]
    .map((s: Record<string, unknown>) => ({
      status: String(s.status ?? ""),
      type: typeof s.type === "string" ? s.type : undefined,
      orderindex: typeof s.orderindex === "number" ? s.orderindex : undefined,
      color: typeof s.color === "string" ? s.color : undefined,
    }))
    .filter((s) => s.status.length > 0)
    .sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));
}

/** Pick the default status name from an already-fetched status list. */
export function pickDefaultStatus(statuses: ClickupListStatus[]): string | undefined {
  if (statuses.length === 0) return undefined;
  const open = statuses.find((s) => s.type === "open");
  return open?.status ?? statuses[0]?.status;
}

/**
 * Match a requested status name (case-insensitive) against the list's statuses.
 * Returns the canonical status casing when found, plus whether it exists.
 */
export function matchListStatus(
  statuses: ClickupListStatus[],
  requested: string | null | undefined,
): { matched?: string; exists: boolean } {
  const want = (requested ?? "").trim().toLowerCase();
  if (!want) return { exists: false };
  const hit = statuses.find((s) => s.status.trim().toLowerCase() === want);
  return { matched: hit?.status, exists: !!hit };
}

/** Convert a whole-minute time estimate to ClickUp's millisecond `time_estimate`. */
export function minutesToClickupTimeEstimate(minutes: number | null | undefined): number | undefined {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Math.round(minutes * 60000);
}

/** Resolve the default/open status name for a ClickUp list (statuses are list-specific). */
export async function resolveListDefaultStatus(
  clickup: { apiToken: string; baseUrl: string },
  listId: string,
): Promise<string | undefined> {
  try {
    const list = await clickupFetch(clickup, `/list/${listId}`);
    const statuses = list?.statuses;
    if (!Array.isArray(statuses) || statuses.length === 0) return undefined;
    const open = statuses.find((s: { type?: string; status?: string }) => s.type === "open");
    if (open?.status) return open.status;
    const sorted = [...statuses].sort(
      (a: { orderindex?: number }, b: { orderindex?: number }) => (a.orderindex ?? 0) - (b.orderindex ?? 0),
    );
    return sorted[0]?.status;
  } catch (err) {
    console.warn("[resolveListDefaultStatus] could not fetch list statuses:", (err as Error).message);
    return undefined;
  }
}

export type EnsureSpaceResult = {
  link: Record<string, unknown>;
  created: boolean;
};

export type ClickupSpaceOption = {
  id: string;
  name: string;
};

function normalizeSpaceName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findClickupSpaceByName(
  spaces: ClickupSpaceOption[],
  targetName: string,
): ClickupSpaceOption | undefined {
  const normalized = normalizeSpaceName(targetName);
  return spaces.find((space) => normalizeSpaceName(space.name) === normalized);
}

export function findOxusProjectClickupSpace(
  spaces: ClickupSpaceOption[],
  projectName: string,
): ClickupSpaceOption | undefined {
  const expected = normalizeSpaceName(`OXUS - ${projectName}`);
  const exact = findClickupSpaceByName(spaces, `OXUS - ${projectName}`);
  if (exact) return exact;

  const projectSuffix = normalizeSpaceName(projectName);
  return spaces.find((space) => {
    const normalized = normalizeSpaceName(space.name);
    if (normalized === expected) return true;
    return normalized.startsWith("oxus - ") && normalized.endsWith(projectSuffix);
  });
}

function resolveExistingSpaceAfterNameConflict(
  spaces: ClickupSpaceOption[],
  spaceName: string,
  projectName: string,
): ClickupSpaceOption | undefined {
  return findClickupSpaceByName(spaces, spaceName)
    ?? findOxusProjectClickupSpace(spaces, projectName);
}

export async function listClickupTeamSpaces(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
): Promise<ClickupSpaceOption[]> {
  const resp = await clickupFetch(clickup, `/team/${clickup.teamId}/space?archived=false`);
  const spaces = Array.isArray(resp?.spaces) ? resp.spaces : [];
  return spaces
    .map((space: { id?: string | number; name?: string }) => ({
      id: space.id !== undefined ? String(space.id) : "",
      name: typeof space.name === "string" ? space.name : String(space.id ?? ""),
    }))
    .filter((space: ClickupSpaceOption) => space.id.length > 0)
    .sort((a: ClickupSpaceOption, b: ClickupSpaceOption) => a.name.localeCompare(b.name));
}

async function provisionDeliveryListInSpace(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
  spaceId: string,
): Promise<{ folderId: string; listId: string; folderName: string; listName: string }> {
  const folderName = "Delivery";
  const listName = "Tasks";

  const foldersResp = await clickupFetch(clickup, `/space/${spaceId}/folder?archived=false`);
  const folders = Array.isArray(foldersResp?.folders) ? foldersResp.folders : [];
  let folderId = folders.find((f: { name?: string }) => f.name === folderName)?.id;
  if (!folderId) {
    const folderResp = await clickupFetch(clickup, `/space/${spaceId}/folder`, {
      method: "POST",
      body: JSON.stringify({ name: folderName }),
    });
    folderId = folderResp.id;
  }
  const folderIdStr = String(folderId);

  const listsResp = await clickupFetch(clickup, `/folder/${folderIdStr}/list?archived=false`);
  const lists = Array.isArray(listsResp?.lists) ? listsResp.lists : [];
  let listId = lists.find((l: { name?: string }) => l.name === listName)?.id;
  if (!listId) {
    const listResp = await clickupFetch(clickup, `/folder/${folderIdStr}/list`, {
      method: "POST",
      body: JSON.stringify({ name: listName }),
    });
    listId = listResp.id;
  }

  return {
    folderId: folderIdStr,
    listId: String(listId),
    folderName,
    listName,
  };
}

async function registerClickupSpaceWebhook(args: {
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  spaceId: string;
  webhookEndpoint?: string;
  webhookSecret?: string;
}): Promise<{ webhookId: string | null; webhookEvents: string[]; webhookScope: string; webhookCreatedAt: string }> {
  let webhookId: string | null = null;
  let webhookEvents: string[] = [...CLICKUP_WEBHOOK_EVENTS];
  const webhookScope = "space";
  const webhookCreatedAt = new Date().toISOString();
  if (args.webhookEndpoint) {
    try {
      const endpoint = args.webhookSecret
        ? `${args.webhookEndpoint}?secret=${encodeURIComponent(args.webhookSecret)}`
        : args.webhookEndpoint;
      let webhookResp: unknown;
      try {
        webhookResp = await clickupFetch(args.clickup, `/team/${args.clickup.teamId}/webhook`, {
          method: "POST",
          body: JSON.stringify({
            endpoint,
            events: webhookEvents,
            space_id: args.spaceId,
          }),
        });
      } catch {
        webhookEvents = ["*"];
        webhookResp = await clickupFetch(args.clickup, `/team/${args.clickup.teamId}/webhook`, {
          method: "POST",
          body: JSON.stringify({
            endpoint,
            events: ["*"],
            space_id: args.spaceId,
          }),
        });
      }
      const resp = webhookResp as { webhook?: { id?: string | number }; id?: string | number };
      webhookId = resp?.webhook?.id ? String(resp.webhook.id) : resp?.id ? String(resp.id) : null;
    } catch (err) {
      console.warn("[registerClickupSpaceWebhook] webhook registration failed (non-fatal):", (err as Error).message);
    }
  }
  return { webhookId, webhookEvents, webhookScope, webhookCreatedAt };
}

async function upsertProjectClickupLink(args: {
  supabase: any;
  projectId: string;
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  spaceId: string;
  spaceName: string;
  folderId: string;
  listId: string;
  folderName: string;
  listName: string;
  webhookId: string | null;
  webhookMetadata: Record<string, unknown>;
  createdBy: string;
  timelineTitle: string;
  timelineSummary: string;
}): Promise<Record<string, unknown>> {
  const linkPayload = {
    project_id: args.projectId,
    clickup_team_id: args.clickup.teamId,
    clickup_space_id: args.spaceId,
    clickup_folder_id: args.folderId,
    clickup_list_id: args.listId,
    clickup_webhook_id: args.webhookId,
    space_name: args.spaceName,
    folder_name: args.folderName,
    list_name: args.listName,
    space_url: `https://app.clickup.com/${args.clickup.teamId}/v/s/${args.spaceId}`,
    list_url: `https://app.clickup.com/${args.clickup.teamId}/v/li/${args.listId}`,
    status: "active",
    last_error: null,
    metadata: args.webhookMetadata,
    created_by: args.createdBy,
  };

  const { data: link, error: linkError } = await args.supabase
    .from("project_clickup_links")
    .upsert(linkPayload, { onConflict: "project_id" })
    .select()
    .single();
  if (linkError) throw new Error(`DB error saving ClickUp link: ${linkError.message}`);

  await args.supabase.from("project_clickup_timeline_events").insert({
    project_id: args.projectId,
    event_type: "project_clickup_space_created",
    event_title: args.timelineTitle,
    event_summary: args.timelineSummary,
    direction: "to_clickup",
    source: "oxus_action",
    raw_payload: {
      space_id: args.spaceId,
      folder_id: args.folderId,
      list_id: args.listId,
      webhook_id: args.webhookId,
    },
  });

  return link as Record<string, unknown>;
}

export async function linkProjectToExistingClickupSpace(args: {
  supabase: any;
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  projectId: string;
  spaceId: string;
  spaceName?: string | null;
  createdBy: string;
  webhookEndpoint: string | undefined;
  webhookSecret: string | undefined;
}): Promise<EnsureSpaceResult> {
  const { supabase, clickup, projectId, spaceId, createdBy } = args;

  const { data: existing } = await supabase
    .from("project_clickup_links")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "active")
    .maybeSingle();

  if (existing?.clickup_space_id && existing?.clickup_folder_id && existing?.clickup_list_id) {
    if (existing.status !== "active") {
      await supabase
        .from("project_clickup_links")
        .update({ status: "active", last_error: null })
        .eq("project_id", projectId);
      existing.status = "active";
    }
    return { link: existing, created: false };
  }

  const { folderId, listId, folderName, listName } = await provisionDeliveryListInSpace(clickup, spaceId);
  const spaceName = args.spaceName?.trim() || `Space ${spaceId}`;
  const { webhookId, webhookEvents, webhookScope, webhookCreatedAt } = await registerClickupSpaceWebhook({
    clickup,
    spaceId,
    webhookEndpoint: args.webhookEndpoint,
    webhookSecret: args.webhookSecret,
  });

  const link = await upsertProjectClickupLink({
    supabase,
    projectId,
    clickup,
    spaceId,
    spaceName,
    folderId,
    listId,
    folderName,
    listName,
    webhookId,
    webhookMetadata: {
      webhook_events: webhookEvents,
      webhook_scope: webhookScope,
      webhook_created_at: webhookCreatedAt,
      linked_existing_space: true,
    },
    createdBy,
    timelineTitle: "Linked existing ClickUp space",
    timelineSummary: `Space: ${spaceName} → ${folderName} → ${listName}`,
  });

  return { link, created: true };
}

/**
 * Ensures a ClickUp Space → Folder → List + webhook exist for the given project.
 * Uses `supabase` (service-role or user-auth client) passed in by the caller.
 * Returns the project_clickup_links row.
 */
export async function ensureProjectClickupSpace(args: {
  supabase: any;
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  projectId: string;
  projectName: string;
  createdBy: string;
  webhookEndpoint: string | undefined;
  webhookSecret: string | undefined;
}): Promise<EnsureSpaceResult> {
  const { supabase, clickup, projectId, projectName, createdBy } = args;
  const spaceName = `OXUS - ${projectName}`;

  const { data: anyLink } = await supabase
    .from("project_clickup_links")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (
    anyLink?.clickup_space_id &&
    anyLink?.clickup_folder_id &&
    anyLink?.clickup_list_id
  ) {
    if (anyLink.status !== "active") {
      await supabase
        .from("project_clickup_links")
        .update({ status: "active", last_error: null })
        .eq("project_id", projectId);
      anyLink.status = "active";
    }
    return { link: anyLink, created: false };
  }

  if (anyLink?.clickup_space_id) {
    return linkProjectToExistingClickupSpace({
      supabase,
      clickup,
      projectId,
      spaceId: String(anyLink.clickup_space_id),
      spaceName: anyLink.space_name ?? spaceName,
      createdBy,
      webhookEndpoint: args.webhookEndpoint,
      webhookSecret: args.webhookSecret,
    });
  }

  const spaces = await listClickupTeamSpaces(clickup);
  const existingByName = findOxusProjectClickupSpace(spaces, projectName)
    ?? findClickupSpaceByName(spaces, spaceName);
  if (existingByName) {
    return linkProjectToExistingClickupSpace({
      supabase,
      clickup,
      projectId,
      spaceId: existingByName.id,
      spaceName: existingByName.name,
      createdBy,
      webhookEndpoint: args.webhookEndpoint,
      webhookSecret: args.webhookSecret,
    });
  }

  let spaceId: string;
  try {
    const spaceResp = await clickupFetch(clickup, `/team/${clickup.teamId}/space`, {
      method: "POST",
      body: JSON.stringify({ name: spaceName, multiple_assignees: true, features: {} }),
    });
    spaceId = String(spaceResp.id);
  } catch (err) {
    const message = (err as Error).message;
    if (/already exists|PROJECT_023/i.test(message)) {
      const refreshed = await listClickupTeamSpaces(clickup);
      const found = resolveExistingSpaceAfterNameConflict(refreshed, spaceName, projectName);
      if (!found) {
        throw new Error(
          `A ClickUp space named "${spaceName}" already exists but is not visible to your connected account. ` +
          "Open Project → ClickUp and link the correct space manually, or ask a workspace admin to grant you access.",
        );
      }
      return linkProjectToExistingClickupSpace({
        supabase,
        clickup,
        projectId,
        spaceId: found.id,
        spaceName: found.name,
        createdBy,
        webhookEndpoint: args.webhookEndpoint,
        webhookSecret: args.webhookSecret,
      });
    }
    throw err;
  }

  const { folderId, listId, folderName, listName } = await provisionDeliveryListInSpace(clickup, spaceId);

  const { webhookId, webhookEvents, webhookScope, webhookCreatedAt } = await registerClickupSpaceWebhook({
    clickup,
    spaceId,
    webhookEndpoint: args.webhookEndpoint,
    webhookSecret: args.webhookSecret,
  });

  const link = await upsertProjectClickupLink({
    supabase,
    projectId,
    clickup,
    spaceId,
    spaceName,
    folderId,
    listId,
    folderName,
    listName,
    webhookId,
    webhookMetadata: {
      webhook_events: webhookEvents,
      webhook_scope: webhookScope,
      webhook_created_at: webhookCreatedAt,
    },
    createdBy,
    timelineTitle: "Created ClickUp space for project",
    timelineSummary: `Space: ${spaceName} → ${folderName} → ${listName}`,
  });

  return { link, created: true };
}

/** Convert YYYY-MM-DD (or ISO datetime) to ClickUp due_date ms timestamp. */
export function dateToClickupDue(dateStr: string, dueDateTime = false): number {
  if (dueDateTime) return new Date(dateStr).getTime();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (match) {
    const [, y, m, d] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);
  }
  return new Date(dateStr).getTime();
}

export async function validateCachedAssigneeIds(
  supabase: any,
  teamId: string,
  assigneeIds: string[],
): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const { data } = await supabase
    .from("clickup_members")
    .select("clickup_user_id")
    .eq("clickup_team_id", teamId)
    .eq("is_active", true)
    .in("clickup_user_id", assigneeIds);
  const allowed = new Set((data ?? []).map((row: { clickup_user_id: string }) => row.clickup_user_id));
  return assigneeIds.filter((id) => allowed.has(id));
}

export async function validateProjectAssignableAssigneeIds(
  supabase: any,
  projectId: string,
  assigneeIds: string[],
): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const { data, error } = await supabase
    .from("project_clickup_assignable_members")
    .select("clickup_user_id")
    .eq("project_id", projectId)
    .eq("is_assignable", true)
    .in("clickup_user_id", assigneeIds);
  if (error) throw new Error(error.message);

  const allowed = new Set((data ?? []).map((row: { clickup_user_id: string }) => row.clickup_user_id));
  const invalid = assigneeIds.filter((id) => !allowed.has(id));
  if (invalid.length > 0) {
    throw new ClickupAssigneeValidationError(CLICKUP_ASSIGNEE_ACCESS_ERROR);
  }
  return assigneeIds;
}

export function isClickupAssigneeApiError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("assignee") || lower.includes("not a member") || lower.includes("does not have access");
}

export async function updateClickupTask(
  clickup: { apiToken: string; baseUrl: string },
  taskId: string,
  body: Record<string, unknown>,
): Promise<any> {
  return clickupFetch(clickup, `/task/${taskId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function assignClickupTask(
  clickup: { apiToken: string; baseUrl: string },
  taskId: string,
  assigneeIds: string[],
): Promise<any> {
  const numericIds = assigneeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  return updateClickupTask(clickup, taskId, {
    assignees: { add: numericIds, rem: [] },
  });
}

export async function setClickupTaskDueDate(
  clickup: { apiToken: string; baseUrl: string },
  taskId: string,
  dueDate: string,
  dueDateTime = false,
): Promise<any> {
  return updateClickupTask(clickup, taskId, {
    due_date: dateToClickupDue(dueDate, dueDateTime),
    due_date_time: dueDateTime,
  });
}

export async function addClickupTaskComment(
  clickup: { apiToken: string; baseUrl: string },
  taskId: string,
  commentText: string,
): Promise<any> {
  return clickupFetch(clickup, `/task/${taskId}/comment`, {
    method: "POST",
    body: JSON.stringify({ comment_text: commentText }),
  });
}

export async function insertOxusTimelineEvent(
  supabase: any,
  args: {
    projectId: string;
    clickupTaskLinkId?: string | null;
    clickupTaskId?: string | null;
    eventType: string;
    eventTitle: string;
    eventSummary: string;
    actorName?: string | null;
    actorEmail?: string | null;
    rawPayload?: Record<string, unknown>;
  },
) {
  await supabase.from("project_clickup_timeline_events").insert({
    project_id: args.projectId,
    clickup_task_link_id: args.clickupTaskLinkId ?? null,
    clickup_task_id: args.clickupTaskId ?? null,
    event_type: args.eventType,
    event_title: args.eventTitle,
    event_summary: args.eventSummary,
    actor_name: args.actorName ?? null,
    actor_email: args.actorEmail ?? null,
    direction: "to_clickup",
    source: "oxus_action",
    raw_payload: args.rawPayload ?? {},
  });
}

export type NormalizedClickupMember = {
  clickup_user_id: string;
  username: string | null;
  email: string | null;
  initials: string | null;
  profile_picture: string | null;
  role: string | null;
  raw_member: Record<string, unknown>;
};

function normalizeMember(raw: any): NormalizedClickupMember | null {
  const user = raw?.user ?? raw;
  const id = user?.id ?? raw?.id;
  if (id === undefined || id === null) return null;
  return {
    clickup_user_id: String(id),
    username: user?.username ?? user?.name ?? raw?.username ?? null,
    email: user?.email ?? raw?.email ?? null,
    initials: user?.initials ?? raw?.initials ?? null,
    profile_picture: user?.profilePicture ?? user?.profile_picture ?? raw?.profile_picture ?? null,
    role: raw?.role ?? user?.role ?? null,
    raw_member: raw,
  };
}

export type ClickupAssignableSyncSource =
  | "list_assignable_users"
  | "space_sharing"
  | "folder_access"
  | "fallback";

export type ClickupAssignableFetchResult = {
  members: NormalizedClickupMember[];
  source: ClickupAssignableSyncSource;
  confidence: "high" | "medium" | "low";
};

function membersFromPayload(payload: unknown): NormalizedClickupMember[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((member) => normalizeMember(member))
    .filter((member): member is NormalizedClickupMember => member !== null);
}

export async function fetchClickupTeamMembers(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
): Promise<NormalizedClickupMember[]> {
  try {
    const teamResp = await clickupFetch(clickup, `/team/${clickup.teamId}`);
    const teamMembers = teamResp?.team?.members ?? teamResp?.members ?? [];
    return membersFromPayload(teamMembers);
  } catch (err) {
    console.warn("[fetchClickupTeamMembers] team members fetch failed:", (err as Error).message);
    return [];
  }
}

/** Workspace-wide member cache (team scope only — not project assignable scope). */
export async function fetchClickupMembers(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
  _listId?: string | null,
): Promise<{ members: NormalizedClickupMember[]; source: "team" }> {
  const members = await fetchClickupTeamMembers(clickup);
  return { members, source: "team" };
}

export async function fetchClickupAssignableMembersForTarget(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
  target: { listId?: string | null; spaceId?: string | null; folderId?: string | null },
): Promise<ClickupAssignableFetchResult> {
  if (target.listId) {
    try {
      const listResp = await clickupFetch(clickup, `/list/${target.listId}/member`);
      const members = membersFromPayload(listResp?.members ?? []);
      if (members.length > 0) {
        return { members, source: "list_assignable_users", confidence: "high" };
      }
    } catch (err) {
      console.warn("[fetchClickupAssignableMembersForTarget] list members fetch failed:", (err as Error).message);
    }
  }

  if (target.spaceId) {
    try {
      const spaceResp = await clickupFetch(clickup, `/space/${target.spaceId}/member`);
      const members = membersFromPayload(spaceResp?.members ?? []);
      if (members.length > 0) {
        return { members, source: "space_sharing", confidence: "medium" };
      }
    } catch (err) {
      console.warn("[fetchClickupAssignableMembersForTarget] space members fetch failed:", (err as Error).message);
    }
  }

  if (target.folderId) {
    try {
      const folderResp = await clickupFetch(clickup, `/folder/${target.folderId}/member`);
      const members = membersFromPayload(folderResp?.members ?? []);
      if (members.length > 0) {
        return { members, source: "folder_access", confidence: "medium" };
      }
    } catch (err) {
      console.warn("[fetchClickupAssignableMembersForTarget] folder members fetch failed:", (err as Error).message);
    }
  }

  return { members: [], source: "fallback", confidence: "low" };
}

export class ClickupAssigneeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClickupAssigneeValidationError";
  }
}

export const CLICKUP_ASSIGNEE_ACCESS_ERROR =
  "This user does not have access to the connected ClickUp Space/List. Share the Space with them in ClickUp, then refresh members.";

export async function upsertProjectClickupAssignableMembers(
  supabase: any,
  projectId: string,
  scope: {
    teamId: string;
    spaceId?: string | null;
    folderId?: string | null;
    listId?: string | null;
  },
  fetched: ClickupAssignableFetchResult,
): Promise<number> {
  const now = new Date().toISOString();
  const rows = fetched.members.map((member) => ({
    project_id: projectId,
    clickup_user_id: member.clickup_user_id,
    team_id: scope.teamId,
    space_id: scope.spaceId ?? null,
    folder_id: scope.folderId ?? null,
    list_id: scope.listId ?? null,
    name: member.username,
    email: member.email,
    role: member.role,
    is_assignable: true,
    reason: null,
    metadata: {
      sync_source: fetched.source,
      confidence: fetched.confidence,
      raw_member: member.raw_member,
    },
    last_synced_at: now,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("project_clickup_assignable_members")
      .upsert(rows, { onConflict: "project_id,clickup_user_id" });
    if (error) throw new Error(error.message);
  }

  const activeIds = new Set(rows.map((row) => row.clickup_user_id));
  const { data: existing } = await supabase
    .from("project_clickup_assignable_members")
    .select("id, clickup_user_id")
    .eq("project_id", projectId)
    .eq("is_assignable", true);

  const staleIds = (existing ?? [])
    .filter((row: { clickup_user_id: string }) => !activeIds.has(row.clickup_user_id))
    .map((row: { id: string }) => row.id);

  if (staleIds.length > 0) {
    await supabase
      .from("project_clickup_assignable_members")
      .update({
        is_assignable: false,
        reason: "No longer returned by ClickUp Space/List member sync.",
        last_synced_at: now,
      })
      .in("id", staleIds);
  }

  return rows.length;
}

export async function upsertClickupMembers(
  supabase: any,
  teamId: string,
  members: NormalizedClickupMember[],
  deactivateMissing = false,
): Promise<number> {
  const now = new Date().toISOString();
  const rows = members.map((member) => ({
    clickup_team_id: teamId,
    clickup_user_id: member.clickup_user_id,
    username: member.username,
    email: member.email,
    initials: member.initials,
    profile_picture: member.profile_picture,
    role: member.role,
    is_active: true,
    raw_member: member.raw_member,
    last_synced_at: now,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("clickup_members")
      .upsert(rows, { onConflict: "clickup_team_id,clickup_user_id" });
    if (error) throw new Error(error.message);
  }

  if (deactivateMissing && members.length > 0) {
    const activeIds = new Set(members.map((m) => m.clickup_user_id));
    const { data: cached } = await supabase
      .from("clickup_members")
      .select("id, clickup_user_id")
      .eq("clickup_team_id", teamId)
      .eq("is_active", true);
    const staleIds = (cached ?? [])
      .filter((row: { clickup_user_id: string }) => !activeIds.has(row.clickup_user_id))
      .map((row: { id: string }) => row.id);
    if (staleIds.length > 0) {
      await supabase.from("clickup_members").update({ is_active: false }).in("id", staleIds);
    }
  }

  return rows.length;
}

export async function fetchClickupTask(clickup: { apiToken: string; baseUrl: string }, taskId: string): Promise<any> {
  return clickupFetch(clickup, `/task/${taskId}`);
}

export async function fetchClickupTaskComments(
  clickup: { apiToken: string; baseUrl: string },
  taskId: string,
): Promise<any[]> {
  const resp = await clickupFetch(clickup, `/task/${taskId}/comment`);
  return Array.isArray(resp?.comments) ? resp.comments : [];
}
