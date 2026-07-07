import {
  buildCommentEventSummary,
  commentTimelineDedupeKey,
  extractCommentMetadataFromApiComment,
  extractCommentTextFromApiComment,
} from "./clickupComments.ts";
import {
  fetchClickupTask,
  fetchClickupTaskComments,
  type ClickupApiEnv,
} from "./clickup.ts";
import { syncClickupTimelineRowToUnified } from "./projectTimelineEvents.ts";

export type SyncProjectClickupResult = {
  skipped: boolean;
  skip_reason?: string;
  imported_events_count: number;
  checked_tasks_count: number;
  comments_imported_count: number;
};

function parseClickupDate(ts: unknown): string | null {
  if (!ts) return null;
  const n = typeof ts === "string" ? parseInt(ts, 10) : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

/**
 * Pull latest ClickUp task snapshots and comments into project timeline.
 * Safe to call before AI analysis. Skips gracefully when project is not linked.
 */
export async function syncProjectClickupUpdates(args: {
  supabase: any;
  clickup: ClickupApiEnv;
  projectId: string;
  syncedVia?: string;
}): Promise<SyncProjectClickupResult> {
  const syncedVia = args.syncedVia ?? "clickup-sync-project-updates";
  const empty: SyncProjectClickupResult = {
    skipped: true,
    imported_events_count: 0,
    checked_tasks_count: 0,
    comments_imported_count: 0,
  };

  const { data: projectLink, error: linkErr } = await args.supabase
    .from("project_clickup_links")
    .select("*")
    .eq("project_id", args.projectId)
    .maybeSingle();
  if (linkErr) throw new Error(linkErr.message);
  if (!projectLink) {
    return { ...empty, skip_reason: "Project is not linked to ClickUp." };
  }

  const { data: taskLinks, error: tasksErr } = await args.supabase
    .from("clickup_task_links")
    .select("*")
    .eq("project_id", args.projectId);
  if (tasksErr) throw new Error(tasksErr.message);

  const links = taskLinks ?? [];
  let importedEventsCount = 0;
  let commentsImportedCount = 0;

  for (const link of links) {
    const taskId = link.clickup_task_id as string;
    let task: any;
    try {
      task = await fetchClickupTask(args.clickup, taskId);
    } catch (e) {
      console.warn(`[syncProjectClickupUpdates] task fetch failed for ${taskId}:`, (e as Error).message);
      continue;
    }

    await args.supabase
      .from("clickup_task_links")
      .update({
        clickup_task_name: task.name ?? link.clickup_task_name,
        clickup_status: task.status?.status ?? link.clickup_status,
        clickup_priority: task.priority?.priority ?? link.clickup_priority,
        clickup_task_url: task.url ?? link.clickup_task_url,
        last_snapshot: task,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    let comments: any[] = [];
    try {
      comments = await fetchClickupTaskComments(args.clickup, taskId);
    } catch (e) {
      console.warn(`[syncProjectClickupUpdates] comments fetch failed for ${taskId}:`, (e as Error).message);
      continue;
    }

    for (const comment of comments) {
      const commentId = comment?.id ? String(comment.id) : null;
      if (!commentId) continue;

      const dedupeKey = commentTimelineDedupeKey(taskId, commentId);
      const { data: existing } = await args.supabase
        .from("project_clickup_timeline_events")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existing) continue;

      const commentText = extractCommentTextFromApiComment(comment);
      const metadata = extractCommentMetadataFromApiComment(comment);
      const actorName = comment?.user?.username ?? comment?.user?.email ?? null;
      const taskName = task.name ?? link.clickup_task_name ?? taskId;
      const summary = buildCommentEventSummary({
        taskName,
        commentText,
        actorName,
        eventType: "taskCommentPosted",
      });

      const { data: inserted, error: insertErr } = await args.supabase.from("project_clickup_timeline_events").insert({
        project_id: args.projectId,
        clickup_task_link_id: link.id,
        clickup_task_id: taskId,
        clickup_comment_id: metadata.clickup_comment_id,
        clickup_parent_comment_id: metadata.clickup_parent_comment_id,
        clickup_thread_id: metadata.clickup_thread_id,
        comment_text: commentText,
        event_type: "taskCommentPosted",
        event_title: "ClickUp comment added",
        event_summary: summary,
        actor_name: actorName,
        actor_email: comment?.user?.email ?? null,
        clickup_date: parseClickupDate(comment.date),
        direction: "from_clickup",
        source: "manual_sync",
        raw_payload: {
          comment,
          comment_text: commentText,
          extracted_comment_text: commentText,
          synced_via: syncedVia,
          clickup_comment_id: metadata.clickup_comment_id,
          clickup_parent_comment_id: metadata.clickup_parent_comment_id,
          clickup_thread_id: metadata.clickup_thread_id,
          task: { name: taskName, id: taskId, url: task.url ?? link.clickup_task_url ?? null },
        },
        dedupe_key: dedupeKey,
      }).select("*").single();

      if (!insertErr && inserted) {
        importedEventsCount += 1;
        commentsImportedCount += 1;
        try {
          await syncClickupTimelineRowToUnified(args.supabase, inserted as Record<string, unknown>);
        } catch (e) {
          console.warn("[syncProjectClickupUpdates] unified timeline sync failed:", (e as Error).message);
        }
      }
    }
  }

  const syncSummary = `Imported ${commentsImportedCount} comment(s) across ${links.length} linked task(s).`;
  await args.supabase.from("project_clickup_timeline_events").insert({
    project_id: args.projectId,
    event_type: "manual_clickup_sync",
    event_title: "Synced latest ClickUp updates",
    event_summary: syncSummary,
    direction: "from_clickup",
    source: "manual_sync",
    raw_payload: {
      imported_events_count: importedEventsCount,
      checked_tasks_count: links.length,
      comments_imported_count: commentsImportedCount,
      synced_via: syncedVia,
    },
  });
  importedEventsCount += 1;

  const now = new Date().toISOString();
  await args.supabase
    .from("project_clickup_links")
    .update({
      last_sync_at: now,
      last_error: null,
      metadata: {
        ...(projectLink.metadata ?? {}),
        needs_ai_review: commentsImportedCount > 0 || (projectLink.metadata as any)?.needs_ai_review === true,
        last_manual_sync_at: now,
        last_manual_sync_imported_count: commentsImportedCount,
        last_manual_sync_checked_tasks: links.length,
      },
    })
    .eq("id", projectLink.id);

  return {
    skipped: false,
    imported_events_count: importedEventsCount,
    checked_tasks_count: links.length,
    comments_imported_count: commentsImportedCount,
  };
}
