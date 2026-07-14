import {
  CLICKUP_TEMPLATE_VERSION,
  CLICKUP_DELIVERY_TEMPLATE_NAME,
  OXUS_CLICKUP_FOLDER_NAME,
  OXUS_CLICKUP_LIST_NAME,
  STATUS_MANUAL_SETUP_INSTRUCTION,
  buildOxusDeliverySpaceFeatures,
  deriveSetupStatus,
  detectMissingRequiredStatuses,
  parseSpaceFeaturesFromApi,
  type ClickupSetupAuditResult,
  type ClickupStatusRow,
} from "./clickupTemplate.ts";
import {
  ClickupSpaceUpdateError,
  updateClickupSpaceSafely,
  type ClickupSpaceUpdateVerification,
} from "./clickupSpaceUpdate.ts";
import {
  clickupFetch,
  fetchClickupAssignableMembersForTarget,
  fetchListStatuses,
  upsertProjectClickupAssignableMembers,
} from "./clickup.ts";
import { provisionDeliveryListInSpace } from "./clickupSetupProvision.ts";

export type ClickupProjectLinkRow = {
  project_id: string;
  clickup_team_id: string;
  clickup_space_id: string | null;
  clickup_folder_id: string | null;
  clickup_list_id: string | null;
  space_name: string | null;
  folder_name: string | null;
  list_name: string | null;
  clickup_template_version?: number | null;
  clickup_setup_status?: string | null;
  clickup_setup_audited_at?: string | null;
  clickup_setup_updated_at?: string | null;
  clickup_setup_snapshot?: Record<string, unknown> | null;
  clickup_setup_warnings?: string[] | null;
  clickup_setup_error?: string | null;
};

export type ClickupSetupUpdatePlan = {
  will_update: string[];
  will_not_change: string[];
  cannot_change_automatically: string[];
  manual_steps: string[];
  will_update_automatically?: string[];
  requires_manual_configuration?: string[];
  will_remain_unchanged?: string[];
};

export type ClickupSetupUpdateResult = {
  status: "succeeded" | "partial" | "failed" | "skipped";
  enabled_automatically: string[];
  requires_manual: string[];
  unchanged: string[];
  warnings: string[];
  diagnostic_code?: string;
};

function folderUrl(teamId: string, folderId: string): string {
  return `https://app.clickup.com/${teamId}/v/f/${folderId}`;
}

function listUrl(teamId: string, listId: string): string {
  return `https://app.clickup.com/${teamId}/v/li/${listId}`;
}

export async function fetchClickupSpaceDetails(
  clickup: { apiToken: string; baseUrl: string },
  spaceId: string,
): Promise<Record<string, unknown>> {
  return clickupFetch(clickup, `/space/${spaceId}`) as Promise<Record<string, unknown>>;
}

export async function fetchClickupSpaceTags(
  clickup: { apiToken: string; baseUrl: string },
  spaceId: string,
): Promise<string[]> {
  try {
    const resp = await clickupFetch(clickup, `/space/${spaceId}/tag`);
    const tags = Array.isArray(resp?.tags) ? resp.tags : [];
    return tags
      .map((tag: { name?: string }) => (typeof tag?.name === "string" ? tag.name : ""))
      .filter((name: string) => name.length > 0)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (err) {
    console.warn("[fetchClickupSpaceTags] failed:", (err as Error).message);
    return [];
  }
}

async function verifyFolderAndList(
  clickup: { apiToken: string; teamId: string; baseUrl: string },
  link: ClickupProjectLinkRow,
): Promise<{
  folder: { exists: boolean; id?: string; name?: string };
  list: { exists: boolean; id?: string; name?: string };
}> {
  const folderId = link.clickup_folder_id ?? undefined;
  const listId = link.clickup_list_id ?? undefined;

  let folderExists = false;
  let folderName = link.folder_name ?? OXUS_CLICKUP_FOLDER_NAME;
  if (folderId) {
    try {
      const folder = await clickupFetch(clickup, `/folder/${folderId}`) as Record<string, unknown>;
      folderExists = true;
      folderName = typeof folder.name === "string" ? folder.name : folderName;
    } catch {
      folderExists = false;
    }
  }

  let listExists = false;
  let listName = link.list_name ?? OXUS_CLICKUP_LIST_NAME;
  if (listId) {
    try {
      const list = await clickupFetch(clickup, `/list/${listId}`) as Record<string, unknown>;
      listExists = true;
      listName = typeof list.name === "string" ? list.name : listName;
    } catch {
      listExists = false;
    }
  }

  return {
    folder: { exists: folderExists, id: folderId, name: folderName },
    list: { exists: listExists, id: listId, name: listName },
  };
}

export async function auditProjectClickupSetup(args: {
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  link: ClickupProjectLinkRow;
  supabase?: any;
}): Promise<ClickupSetupAuditResult> {
  const { clickup, link } = args;
  const warnings: string[] = [];
  const manual_steps: string[] = [];

  if (!link.clickup_space_id) {
    return {
      status: "missing_required",
      template_version: CLICKUP_TEMPLATE_VERSION,
      applied_template_version: link.clickup_template_version ?? null,
      template_name: CLICKUP_DELIVERY_TEMPLATE_NAME,
      space: { exists: false },
      folder: { exists: false },
      list: { exists: false },
      capabilities: {
        statuses: { available: false, missing: [], present: [] },
        assignees: { available: false, member_count: 0, multiple_assignees: false },
        start_date: { available: false },
        due_date: { available: false },
        priority: { available: false },
        time_estimate: { available: false },
        time_tracking: { available: false },
        tags: { available: false },
      },
      warnings: ["Project is not linked to a ClickUp Space."],
      manual_steps: [],
    };
  }

  let spaceResp: Record<string, unknown>;
  try {
    spaceResp = await fetchClickupSpaceDetails(clickup, link.clickup_space_id);
  } catch (err) {
    return {
      status: "access_required",
      template_version: CLICKUP_TEMPLATE_VERSION,
      applied_template_version: link.clickup_template_version ?? null,
      template_name: CLICKUP_DELIVERY_TEMPLATE_NAME,
      space: { exists: false, id: link.clickup_space_id, name: link.space_name ?? undefined },
      folder: { exists: !!link.clickup_folder_id, id: link.clickup_folder_id ?? undefined },
      list: { exists: !!link.clickup_list_id, id: link.clickup_list_id ?? undefined },
      capabilities: {
        statuses: { available: false, missing: [], present: [] },
        assignees: { available: false, member_count: 0, multiple_assignees: false },
        start_date: { available: false },
        due_date: { available: false },
        priority: { available: false },
        time_estimate: { available: false },
        time_tracking: { available: false },
        tags: { available: false },
      },
      warnings: [(err as Error).message],
      manual_steps: ["Verify your ClickUp account has access to this Space, then reconnect if needed."],
    };
  }

  const features = parseSpaceFeaturesFromApi(spaceResp.features);
  const hierarchy = await verifyFolderAndList(clickup, link);

  let listStatuses: ClickupStatusRow[] = [];
  if (link.clickup_list_id) {
    try {
      listStatuses = await fetchListStatuses(clickup, link.clickup_list_id);
    } catch (err) {
      warnings.push(`Could not load list statuses: ${(err as Error).message}`);
    }
  }

  const spaceStatuses = Array.isArray(spaceResp.statuses)
    ? (spaceResp.statuses as ClickupStatusRow[])
    : [];
  const statusesForAudit = listStatuses.length > 0 ? listStatuses : spaceStatuses;
  const missingStatuses = detectMissingRequiredStatuses(statusesForAudit);
  const presentStatuses = statusesForAudit.map((s) => s.status);

  let memberCount = 0;
  if (args.supabase) {
    const assignable = await fetchClickupAssignableMembersForTarget(clickup, {
      listId: link.clickup_list_id,
      spaceId: link.clickup_space_id,
      folderId: link.clickup_folder_id,
    });
    memberCount = assignable.members.length;
  }

  const multipleAssignees = spaceResp.multiple_assignees === true;

  if (missingStatuses.length > 0) {
    manual_steps.push(STATUS_MANUAL_SETUP_INSTRUCTION);
    manual_steps.push(`Missing statuses: ${missingStatuses.join(", ")}`);
  }

  const timeTrackingAvailable = features.time_tracking.enabled;
  const timeEstimateAvailable = features.time_estimates.enabled;
  const tagsAvailable = features.tags.enabled;
  const startDateAvailable = features.due_dates.enabled && features.due_dates.start_date;
  const dueDateAvailable = features.due_dates.enabled;

  if (!timeTrackingAvailable) {
    manual_steps.push(
      "Enable Time Tracking for this Space in ClickUp (Space settings → ClickApps) if your plan allows it.",
    );
  }

  const audit: ClickupSetupAuditResult = {
    status: "unverified",
    template_version: CLICKUP_TEMPLATE_VERSION,
    applied_template_version: link.clickup_template_version ?? null,
    template_name: CLICKUP_DELIVERY_TEMPLATE_NAME,
    space: {
      exists: true,
      id: link.clickup_space_id,
      name: typeof spaceResp.name === "string" ? spaceResp.name : link.space_name ?? undefined,
    },
    folder: hierarchy.folder,
    list: hierarchy.list,
    capabilities: {
      statuses: {
        available: missingStatuses.length === 0,
        missing: missingStatuses,
        present: presentStatuses,
      },
      assignees: {
        available: memberCount > 0,
        member_count: memberCount,
        multiple_assignees: multipleAssignees,
      },
      start_date: {
        available: startDateAvailable,
        manual_step: startDateAvailable
          ? undefined
          : "Enable due dates and start dates for this Space in ClickUp, or run Update ClickUp setup.",
      },
      due_date: { available: dueDateAvailable },
      priority: { available: true },
      time_estimate: {
        available: timeEstimateAvailable,
        manual_step: timeEstimateAvailable
          ? undefined
          : "Enable time estimates for this Space in ClickUp, or run Update ClickUp setup.",
      },
      time_tracking: {
        available: timeTrackingAvailable,
        manual_step: timeTrackingAvailable
          ? undefined
          : "Enable time tracking for this Space in ClickUp if your workspace plan supports it.",
      },
      tags: {
        available: tagsAvailable,
        manual_step: tagsAvailable ? undefined : "Enable tags for this Space in ClickUp, or run Update ClickUp setup.",
      },
    },
    warnings,
    manual_steps,
  };

  audit.status = deriveSetupStatus(audit);
  return audit;
}

export function buildClickupSetupUpdatePlan(audit: ClickupSetupAuditResult): ClickupSetupUpdatePlan {
  const will_update: string[] = [];
  const cannot_change_automatically: string[] = [];
  const manual_steps = [...audit.manual_steps];

  const caps = audit.capabilities;
  if (!caps.start_date.available) will_update.push("Enable start dates");
  if (!caps.due_date.available) will_update.push("Enable due dates");
  if (!caps.time_estimate.available) will_update.push("Enable time estimates");
  if (!caps.time_tracking.available) will_update.push("Enable time tracking");
  if (!caps.tags.available) will_update.push("Enable tags");
  if (!caps.assignees.multiple_assignees) will_update.push("Enable multiple assignees");

  for (const status of caps.statuses.missing) {
    cannot_change_automatically.push(`Add ${status} status (manual in ClickUp)`);
  }

  if (!audit.folder.exists) will_update.push(`Restore ${OXUS_CLICKUP_FOLDER_NAME} folder`);
  if (!audit.list.exists) will_update.push(`Restore ${OXUS_CLICKUP_LIST_NAME} list`);

  return {
    will_update,
    will_update_automatically: will_update,
    will_not_change: [
      "Private Space setting",
      "Admin management of private Spaces (Enterprise)",
      "Existing statuses",
      "Existing tags",
      "Existing tasks",
      "Existing assignees on tasks",
      "Existing dates and estimates on tasks",
      "Custom fields created by the delivery team",
    ],
    will_remain_unchanged: [
      "Private Space setting",
      "Admin management of private Spaces (Enterprise)",
      "Existing statuses",
      "Existing tags",
      "Existing tasks",
      "Existing assignees on tasks",
      "Existing dates and estimates on tasks",
      "Custom fields created by the delivery team",
    ],
    cannot_change_automatically,
    requires_manual_configuration: cannot_change_automatically,
    manual_steps,
  };
}

export async function applyClickupSetupUpdate(args: {
  supabase: any;
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  projectId: string;
  link: ClickupProjectLinkRow;
  actorUserId: string;
  webhookEndpoint?: string;
  webhookSecret?: string;
}): Promise<{
  audit: ClickupSetupAuditResult;
  plan: ClickupSetupUpdatePlan;
  applied_changes: string[];
  execution_id?: string;
  update_result: ClickupSetupUpdateResult;
}> {
  const preAudit = await auditProjectClickupSetup({
    clickup: args.clickup,
    link: args.link,
    supabase: args.supabase,
  });
  const plan = buildClickupSetupUpdatePlan(preAudit);
  const applied_changes: string[] = [];
  const updateWarnings: string[] = [];

  if (!args.link.clickup_space_id) {
    throw new Error("Project is not linked to a ClickUp Space.");
  }

  const enableMultipleAssignees = !preAudit.capabilities.assignees.multiple_assignees;
  let spaceUpdate: ClickupSpaceUpdateVerification = {
    enabled_automatically: [],
    requires_manual: [],
    unchanged: ["Admin management of private Spaces"],
  };
  let spaceUpdateStatus: ClickupSetupUpdateResult["status"] = "skipped";
  let diagnosticCode: string | undefined;

  try {
    const outcome = await updateClickupSpaceSafely(args.clickup, args.link.clickup_space_id, {
      fallbackSpaceName: args.link.space_name,
      enableMultipleAssignees,
      approvedFeatureChanges: buildOxusDeliverySpaceFeatures(),
    });
    spaceUpdate = outcome.verification;
    updateWarnings.push(...outcome.warnings);
    diagnosticCode = outcome.diagnostic_code;

    if (!outcome.skipped) {
      spaceUpdateStatus = outcome.verification.requires_manual.length > 0 ? "partial" : "succeeded";
      for (const item of outcome.verification.enabled_automatically) {
        applied_changes.push(`Enabled ${item.toLowerCase()}`);
      }
    }
  } catch (err) {
    if (err instanceof ClickupSpaceUpdateError) {
      diagnosticCode = err.diagnostic_code;
      updateWarnings.push(err.message);
      if (err.partial_outcome) {
        spaceUpdate = err.partial_outcome.verification;
      }
      spaceUpdateStatus = "failed";
    } else {
      throw err;
    }
  }

  const provisioned = await provisionDeliveryListInSpace(args.clickup, args.link.clickup_space_id);
  if (!preAudit.folder.exists) {
    applied_changes.push(`Ensured ${OXUS_CLICKUP_FOLDER_NAME} folder`);
  }
  if (!preAudit.list.exists) {
    applied_changes.push(`Ensured ${OXUS_CLICKUP_LIST_NAME} list`);
  }

  const assignable = await fetchClickupAssignableMembersForTarget(args.clickup, {
    listId: provisioned.listId,
    spaceId: args.link.clickup_space_id,
    folderId: provisioned.folderId,
  });
  await upsertProjectClickupAssignableMembers(
    args.supabase,
    args.projectId,
    {
      teamId: args.clickup.teamId,
      spaceId: args.link.clickup_space_id,
      folderId: provisioned.folderId,
      listId: provisioned.listId,
    },
    assignable,
  );
  applied_changes.push("Refreshed assignable members");

  if (spaceUpdateStatus === "failed" && applied_changes.length > 0) {
    spaceUpdateStatus = "partial";
  }

  const postAudit = await auditProjectClickupSetup({
    clickup: args.clickup,
    link: {
      ...args.link,
      clickup_folder_id: provisioned.folderId,
      clickup_list_id: provisioned.listId,
      folder_name: provisioned.folderName,
      list_name: provisioned.listName,
    },
    supabase: args.supabase,
  });

  const requiresManual = [
    ...spaceUpdate.requires_manual,
    ...postAudit.capabilities.statuses.missing.map((status) => `Add ${status} status (manual in ClickUp)`),
  ];
  if (spaceUpdateStatus !== "failed" && requiresManual.length > 0) {
    spaceUpdateStatus = applied_changes.length > 0 || spaceUpdate.enabled_automatically.length > 0
      ? "partial"
      : "partial";
  }

  const update_result: ClickupSetupUpdateResult = {
    status: spaceUpdateStatus,
    enabled_automatically: spaceUpdate.enabled_automatically,
    requires_manual: requiresManual,
    unchanged: spaceUpdate.unchanged,
    warnings: updateWarnings,
    diagnostic_code: diagnosticCode,
  };

  const now = new Date().toISOString();
  const executionStatus = spaceUpdateStatus === "failed" && applied_changes.length === 0
    ? "failed"
    : postAudit.status === "configured"
    ? "succeeded"
    : "partial";

  const updatePayload = {
    clickup_folder_id: provisioned.folderId,
    clickup_list_id: provisioned.listId,
    folder_name: provisioned.folderName,
    list_name: provisioned.listName,
    list_url: listUrl(args.clickup.teamId, provisioned.listId),
    clickup_template_version: CLICKUP_TEMPLATE_VERSION,
    clickup_setup_status: postAudit.status,
    clickup_setup_audited_at: now,
    clickup_setup_updated_at: now,
    clickup_setup_snapshot: postAudit,
    clickup_setup_warnings: [...postAudit.warnings, ...updateWarnings],
    clickup_setup_error: spaceUpdateStatus === "failed" && applied_changes.length === 0
      ? updateWarnings[0] ?? null
      : null,
    clickup_setup_updated_by: args.actorUserId,
    last_error: spaceUpdateStatus === "failed" && applied_changes.length === 0
      ? updateWarnings[0] ?? null
      : null,
    status: "active",
  };

  await args.supabase
    .from("project_clickup_links")
    .update(updatePayload)
    .eq("project_id", args.projectId);

  const { data: execution } = await args.supabase
    .from("clickup_setup_executions")
    .insert({
      project_id: args.projectId,
      actor_user_id: args.actorUserId,
      clickup_space_id: args.link.clickup_space_id,
      previous_template_version: args.link.clickup_template_version ?? null,
      target_template_version: CLICKUP_TEMPLATE_VERSION,
      status: executionStatus,
      planned_changes: plan,
      applied_changes,
      warnings: [...postAudit.warnings, ...updateWarnings],
      error: spaceUpdateStatus === "failed" && applied_changes.length === 0
        ? updateWarnings[0] ?? null
        : null,
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .single();

  return {
    audit: postAudit,
    plan,
    applied_changes,
    execution_id: execution?.id,
    update_result,
  };
}

export async function persistClickupSetupAudit(args: {
  supabase: any;
  projectId: string;
  link: ClickupProjectLinkRow;
  audit: ClickupSetupAuditResult;
  actorUserId?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await args.supabase
    .from("project_clickup_links")
    .update({
      clickup_setup_status: args.audit.status,
      clickup_setup_audited_at: now,
      clickup_setup_snapshot: args.audit,
      clickup_setup_warnings: args.audit.warnings,
      clickup_setup_error: null,
    })
    .eq("project_id", args.projectId);
}

export function buildClickupDiagnosticsSummary(args: {
  oxusUser?: string | null;
  clickupAccount?: string | null;
  workspace?: string | null;
  link: ClickupProjectLinkRow;
  audit: ClickupSetupAuditResult;
  lastError?: string | null;
}): string {
  const lines = [
    "OXUS ClickUp Setup Diagnostics",
    "--------------------------------",
    `Template: ${CLICKUP_DELIVERY_TEMPLATE_NAME} v${CLICKUP_TEMPLATE_VERSION}`,
    `Applied template version: ${args.audit.applied_template_version ?? "none"}`,
    `Setup status: ${args.audit.status}`,
    `Connected OXUS user: ${args.oxusUser ?? "—"}`,
    `ClickUp account: ${args.clickupAccount ?? "—"}`,
    `Workspace: ${args.workspace ?? args.link.clickup_team_id}`,
    `Space: ${args.audit.space.name ?? "—"} (${args.link.clickup_space_id ?? "—"})`,
    `Folder: ${args.audit.folder.name ?? "—"} (${args.link.clickup_folder_id ?? "—"})`,
    `List: ${args.audit.list.name ?? "—"} (${args.link.clickup_list_id ?? "—"})`,
    `Required statuses missing: ${args.audit.capabilities.statuses.missing.join(", ") || "none"}`,
    `Assignable members: ${args.audit.capabilities.assignees.member_count}`,
    `Multiple assignees: ${args.audit.capabilities.assignees.multiple_assignees ? "yes" : "no"}`,
    `Start date: ${args.audit.capabilities.start_date.available ? "available" : "missing"}`,
    `Due date: ${args.audit.capabilities.due_date.available ? "available" : "missing"}`,
    `Priority: ${args.audit.capabilities.priority.available ? "available" : "missing"}`,
    `Time estimate: ${args.audit.capabilities.time_estimate.available ? "available" : "missing"}`,
    `Time tracking: ${args.audit.capabilities.time_tracking.available ? "available" : "missing"}`,
    `Tags: ${args.audit.capabilities.tags.available ? "available" : "missing"}`,
    `Last audited: ${args.link.clickup_setup_audited_at ?? "—"}`,
    `Last update: ${args.link.clickup_setup_updated_at ?? "—"}`,
    `Last error: ${args.lastError ?? args.link.clickup_setup_error ?? "—"}`,
  ];
  if (args.audit.manual_steps.length > 0) {
    lines.push("Manual steps:");
    for (const step of args.audit.manual_steps) lines.push(`- ${step}`);
  }
  return lines.join("\n");
}
