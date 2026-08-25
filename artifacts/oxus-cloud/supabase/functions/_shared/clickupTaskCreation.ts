import {
  clickupFetch,
  ensureProjectClickupSpace,
  fetchListStatuses,
  pickDefaultStatus,
  ClickupAssigneeValidationError,
  CLICKUP_ASSIGNEE_ACCESS_ERROR,
  isClickupAssigneeApiError,
  validateProjectAssignableAssigneeIds,
} from "./clickup.ts";
import { fetchClickupSpaceTags } from "./clickupProjectSetup.ts";
import { resolveStatusIntent } from "./clickupTemplate.ts";
import {
  dateToClickupDue,
  dateToClickupStart,
  matchExistingTags,
  normalizeOxusPriority,
  normalizeTagNames,
  oxusPriorityToClickup,
  validateTaskDateRange,
  minutesToClickupTimeEstimate,
} from "./clickupTaskFields.ts";
import { auditProjectClickupSetup } from "./clickupProjectSetup.ts";
import { detectDuplicateTask } from "./task-generation/duplicateDetection.ts";

export type ClickupTaskSourceType =
  | "ai_proposal"
  | "pm_action"
  | "slack"
  | "agent"
  | "manual";

export type CreateProjectClickUpTaskInput = {
  projectId: string;
  actorUserId: string;
  sourceType: ClickupTaskSourceType;
  sourceId: string;
  name: string;
  description?: string | null;
  markdownContent?: string | null;
  statusIdOrName?: string | null;
  assigneeUserIds?: string[];
  priority?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  timeEstimateMs?: number | null;
  timeEstimateMinutes?: number | null;
  tagNames?: string[];
  allowCreateTags?: boolean;
};

export type CreateProjectClickUpTaskResult = {
  clickupTaskId: string;
  clickupTaskUrl: string;
  clickupTask: Record<string, unknown>;
  projectClickupLink: Record<string, unknown>;
  warnings: string[];
  resolvedStatus?: string;
  resolvedTags: string[];
};

async function applyTagsToTask(
  clickup: { apiToken: string; baseUrl: string },
  taskId: string,
  tags: string[],
): Promise<void> {
  for (const tag of tags) {
    const encoded = encodeURIComponent(tag);
    try {
      await clickupFetch(clickup, `/task/${taskId}/tag/${encoded}`, { method: "POST" });
    } catch (err) {
      console.warn(`[applyTagsToTask] failed for tag "${tag}":`, (err as Error).message);
    }
  }
}

async function createSpaceTagIfNeeded(
  clickup: { apiToken: string; baseUrl: string },
  spaceId: string,
  tagName: string,
): Promise<void> {
  try {
    await clickupFetch(clickup, `/space/${spaceId}/tag`, {
      method: "POST",
      body: JSON.stringify({
        tag: {
          name: tagName,
          tag_fg: "#FFFFFF",
          tag_bg: "#7B68EE",
        },
      }),
    });
  } catch (err) {
    console.warn(`[createSpaceTagIfNeeded] could not create tag "${tagName}":`, (err as Error).message);
  }
}

async function assertNoMatchingClickupTask(args: {
  clickup: { apiToken: string; baseUrl: string };
  listId: string;
  name: string;
  description?: string | null;
}): Promise<void> {
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 0; page < 2; page += 1) {
    const response = await clickupFetch(
      args.clickup,
      `/list/${args.listId}/task?archived=false&include_closed=true&subtasks=true&page=${page}`,
    ) as { tasks?: Array<Record<string, unknown>> };
    const tasks = response.tasks ?? [];
    rows.push(...tasks);
    if (tasks.length < 100) break;
  }

  const existingTasks = rows.map((task) => ({
    id: String(task.id ?? ""),
    title: String(task.name ?? ""),
    status: typeof (task.status as { status?: unknown } | null)?.status === "string"
      ? String((task.status as { status: string }).status)
      : null,
    source: typeof task.url === "string" ? task.url : null,
  })).filter((task) => task.id && task.title);
  const duplicate = detectDuplicateTask({
    request: `${args.name}\n${args.description ?? ""}`,
    proposedTitle: args.name,
    existingTasks,
  });
  if (!duplicate.is_duplicate || !duplicate.duplicate_candidate_id) return;

  const match = existingTasks.find((task) => task.id === duplicate.duplicate_candidate_id);
  const status = match?.status ? ` (${match.status})` : "";
  const url = match?.source ? ` ${match.source}` : "";
  throw new Error(
    `A matching ClickUp task already exists: "${match?.title ?? args.name}"${status}.${url}`,
  );
}

export async function createProjectClickUpTask(args: {
  supabase: any;
  clickup: { apiToken: string; teamId: string; baseUrl: string };
  input: CreateProjectClickUpTaskInput;
  webhookEndpoint?: string;
  webhookSecret?: string;
  existingTaskLinkQuery?: { column: string; value: string } | null;
}): Promise<CreateProjectClickUpTaskResult> {
  const { supabase, clickup, input } = args;
  const warnings: string[] = [];

  if (!input.name.trim()) throw new Error("Task name is required.");

  if (args.existingTaskLinkQuery) {
    const { data: existing } = await supabase
      .from("clickup_task_links")
      .select("*")
      .eq(args.existingTaskLinkQuery.column, args.existingTaskLinkQuery.value)
      .maybeSingle();
    if (existing?.clickup_task_id) {
      return {
        clickupTaskId: existing.clickup_task_id,
        clickupTaskUrl: existing.clickup_task_url ?? `https://app.clickup.com/t/${existing.clickup_task_id}`,
        clickupTask: (existing.last_snapshot ?? {}) as Record<string, unknown>,
        projectClickupLink: {},
        warnings: ["Task already exists for this source."],
        resolvedTags: [],
      };
    }
  }

  const dateError = validateTaskDateRange(input.startDate, input.dueDate);
  if (dateError) throw new Error(dateError);

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", input.projectId)
    .single();
  if (!project) throw new Error("Project not found.");

  const spaceResult = await ensureProjectClickupSpace({
    supabase,
    clickup,
    projectId: input.projectId,
    projectName: String(project.name ?? "Project"),
    createdBy: input.actorUserId,
    webhookEndpoint: args.webhookEndpoint,
    webhookSecret: args.webhookSecret,
  });

  const link = spaceResult.link as Record<string, unknown>;
  const listId = String(link.clickup_list_id ?? "");
  const spaceId = String(link.clickup_space_id ?? "");
  if (!listId) throw new Error("ClickUp list is not configured for this project.");

  const setupAudit = await auditProjectClickupSetup({
    clickup,
    link: {
      project_id: input.projectId,
      clickup_team_id: clickup.teamId,
      clickup_space_id: spaceId,
      clickup_folder_id: (link.clickup_folder_id as string | null) ?? null,
      clickup_list_id: listId,
      space_name: (link.space_name as string | null) ?? null,
      folder_name: (link.folder_name as string | null) ?? null,
      list_name: (link.list_name as string | null) ?? null,
      clickup_template_version: (link.clickup_template_version as number | null) ?? null,
    },
    supabase,
  });

  if (setupAudit.status === "missing_required" || setupAudit.status === "access_required") {
    throw new Error("ClickUp setup is not verified for this project. Run Audit or Update ClickUp setup first.");
  }

  await assertNoMatchingClickupTask({
    clickup,
    listId,
    name: input.name.trim(),
    description: input.markdownContent ?? input.description,
  });

  const assigneeIds = (input.assigneeUserIds ?? []).filter((id) => typeof id === "string" && id.trim());
  let validatedAssigneeIds: string[];
  try {
    validatedAssigneeIds = await validateProjectAssignableAssigneeIds(supabase, input.projectId, assigneeIds);
  } catch (e) {
    if (e instanceof ClickupAssigneeValidationError) throw e;
    throw e;
  }

  const statuses = await fetchListStatuses(clickup, listId);
  const defaultStatus = pickDefaultStatus(statuses);
  let resolvedStatus = defaultStatus;
  if (input.statusIdOrName?.trim()) {
    const intent = resolveStatusIntent(statuses, input.statusIdOrName);
    if (intent.exists && intent.matched) resolvedStatus = intent.matched;
    else {
      warnings.push(
        `Requested status "${input.statusIdOrName}" does not exist in the ClickUp list. Used "${
          defaultStatus ?? "list default"
        }" instead.`,
      );
    }
  }

  const priority = normalizeOxusPriority(input.priority);
  const priorityInt = oxusPriorityToClickup(priority);
  const estimateMs =
    (typeof input.timeEstimateMs === "number" && input.timeEstimateMs > 0 ? input.timeEstimateMs : undefined) ??
    minutesToClickupTimeEstimate(input.timeEstimateMinutes);

  const availableTags = spaceId ? await fetchClickupSpaceTags(clickup, spaceId) : [];
  const requestedTags = normalizeTagNames(input.tagNames ?? []);
  const { matched: resolvedTags, missing: missingTags } = matchExistingTags(requestedTags, availableTags);

  if (missingTags.length > 0) {
    if (input.allowCreateTags) {
      for (const tag of missingTags) {
        await createSpaceTagIfNeeded(clickup, spaceId, tag);
        resolvedTags.push(tag);
      }
    } else {
      warnings.push(`Tags not found in ClickUp Space and were skipped: ${missingTags.join(", ")}`);
    }
  }

  const taskBody: Record<string, unknown> = {
    name: input.name.trim(),
  };
  if (input.markdownContent?.trim()) taskBody.markdown_content = input.markdownContent.trim();
  else if (input.description?.trim()) taskBody.description = input.description.trim();

  if (resolvedStatus) taskBody.status = resolvedStatus;
  if (priorityInt !== undefined) taskBody.priority = priorityInt;
  if (estimateMs !== undefined) taskBody.time_estimate = estimateMs;
  if (validatedAssigneeIds.length > 0) {
    taskBody.assignees = validatedAssigneeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  }
  if (input.startDate?.trim()) {
    taskBody.start_date = dateToClickupStart(input.startDate, false);
    taskBody.start_date_time = false;
  }
  if (input.dueDate?.trim()) {
    taskBody.due_date = dateToClickupDue(input.dueDate, false);
    taskBody.due_date_time = false;
  }
  if (resolvedTags.length > 0) taskBody.tags = resolvedTags;

  let clickupTask: Record<string, unknown>;
  try {
    clickupTask = await clickupFetch(clickup, `/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(taskBody),
    }) as Record<string, unknown>;
  } catch (e) {
    const message = (e as Error).message;
    if (isClickupAssigneeApiError(message)) {
      throw new ClickupAssigneeValidationError(CLICKUP_ASSIGNEE_ACCESS_ERROR);
    }
    throw e;
  }

  const clickupTaskId = String(clickupTask.id);
  const clickupTaskUrl =
    (typeof clickupTask.url === "string" ? clickupTask.url : null) ??
    `https://app.clickup.com/t/${clickupTaskId}`;

  if (resolvedTags.length > 0 && !Array.isArray(clickupTask.tags)) {
    await applyTagsToTask(clickup, clickupTaskId, resolvedTags);
  }

  return {
    clickupTaskId,
    clickupTaskUrl,
    clickupTask,
    projectClickupLink: link,
    warnings,
    resolvedStatus: resolvedStatus ?? undefined,
    resolvedTags,
  };
}
