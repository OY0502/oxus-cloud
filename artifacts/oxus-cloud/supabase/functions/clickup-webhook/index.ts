/**
 * Public ClickUp webhook receiver.
 * No user auth required — ClickUp calls this endpoint.
 * Validates ?secret= query param, stores all events, maps to project timeline.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCommentEventSummary,
  extractCommentMetadataFromPayload,
  extractCommentTextFromPayload,
} from "../_shared/clickupComments.ts";
import { syncClickupTimelineRowToUnified } from "../_shared/projectTimelineEvents.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
}

function eventTitle(eventType: string): string {
  const map: Record<string, string> = {
    taskCreated: "ClickUp task created",
    taskUpdated: "ClickUp task updated",
    taskDeleted: "ClickUp task deleted",
    taskStatusUpdated: "ClickUp status changed",
    taskPriorityUpdated: "ClickUp priority changed",
    taskAssigneeUpdated: "ClickUp assignee changed",
    taskDueDateUpdated: "ClickUp due date changed",
    taskCommentPosted: "ClickUp comment added",
    taskCommentUpdated: "ClickUp comment updated",
    taskMoved: "ClickUp task moved",
    taskClosed: "ClickUp task completed",
    taskReopened: "ClickUp task reopened",
  };
  return map[eventType] ?? `ClickUp: ${eventType}`;
}

function eventSummary(eventType: string, payload: any, commentText: string | null, taskName: string): string {
  const actor = payload?.history_items?.[0]?.user?.username ?? payload?.actor?.username ?? null;
  const before = payload?.history_items?.[0]?.before ?? null;
  const after = payload?.history_items?.[0]?.after ?? null;
  const actorPart = actor ? ` by ${actor}` : "";

  if (eventType === "taskCommentPosted" || eventType === "taskCommentUpdated") {
    return buildCommentEventSummary({
      taskName,
      commentText,
      actorName: actor,
      eventType,
    });
  }
  if (eventType === "taskStatusUpdated" && before && after) {
    return `"${taskName}" status changed from "${before}" → "${after}"${actorPart}`;
  }
  if (eventType === "taskPriorityUpdated" && before !== undefined && after !== undefined) {
    return `"${taskName}" priority changed${actorPart}`;
  }
  if (eventType === "taskClosed") return `"${taskName}" completed${actorPart}`;
  if (eventType === "taskReopened") return `"${taskName}" reopened${actorPart}`;
  if (eventType === "taskCreated") return `"${taskName}" created${actorPart}`;
  return `"${taskName}" updated${actorPart}`;
}

function parseClickupDate(ts: unknown): string | null {
  if (!ts) return null;
  const n = typeof ts === "string" ? parseInt(ts, 10) : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

function stableHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildDedupeKey(payload: any, rawBody: string): string {
  const clickupWebhookId = payload?.webhook_id ?? "unknown";
  const historyId = payload?.history_items?.[0]?.id ?? null;
  const eventType = payload?.event ?? "unknown";
  const clickupTaskId = payload?.task_id ?? payload?.task?.id ?? "unknown";
  const date = payload?.date ?? "";

  if (historyId) {
    return `cu_wh_${clickupWebhookId}_h_${historyId}`;
  }
  return `cu_wh_${stableHash(`${clickupWebhookId}:${eventType}:${clickupTaskId}:${date}:${rawBody.slice(0, 400)}`)}`;
}

async function resolveProjectId(
  supabase: any,
  payload: any,
  clickupTaskId: string | null,
): Promise<{ projectId: string | null; taskLinkId: string | null }> {
  let taskLinkId: string | null = null;

  if (clickupTaskId) {
    const { data: taskLink } = await supabase
      .from("clickup_task_links")
      .select("id, project_id")
      .eq("clickup_task_id", clickupTaskId)
      .maybeSingle();
    if (taskLink) {
      return { projectId: taskLink.project_id, taskLinkId: taskLink.id };
    }
  }

  const listId =
    payload?.list_id ??
    payload?.task?.list?.id ??
    payload?.history_items?.[0]?.parent_id ??
    null;
  const folderId = payload?.task?.folder?.id ?? payload?.folder_id ?? null;
  const spaceId = payload?.task?.space?.id ?? payload?.space_id ?? null;

  if (listId) {
    const { data: projectLink } = await supabase
      .from("project_clickup_links")
      .select("project_id")
      .eq("clickup_list_id", String(listId))
      .maybeSingle();
    if (projectLink?.project_id) return { projectId: projectLink.project_id, taskLinkId: null };
  }

  if (folderId) {
    const { data: projectLink } = await supabase
      .from("project_clickup_links")
      .select("project_id")
      .eq("clickup_folder_id", String(folderId))
      .maybeSingle();
    if (projectLink?.project_id) return { projectId: projectLink.project_id, taskLinkId: null };
  }

  if (spaceId) {
    const { data: projectLink } = await supabase
      .from("project_clickup_links")
      .select("project_id")
      .eq("clickup_space_id", String(spaceId))
      .maybeSingle();
    if (projectLink?.project_id) return { projectId: projectLink.project_id, taskLinkId: null };
  }

  return { projectId: null, taskLinkId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) {
    return err("Missing Supabase environment.", 500, "CONFIG_ERROR");
  }

  const url = new URL(req.url);
  const webhookSecret = Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim();
  if (webhookSecret) {
    const provided = url.searchParams.get("secret");
    if (provided !== webhookSecret) {
      return err("Invalid webhook secret.", 401, "AUTH_REQUIRED");
    }
  }

  let rawBody = "";
  let payload: any;
  try {
    rawBody = await req.text();
    payload = JSON.parse(rawBody);
  } catch {
    return err("Invalid JSON payload.", 400, "INVALID_INPUT");
  }

  const eventType: string = payload?.event ?? "unknown";
  const clickupTaskId: string | null = payload?.task_id ? String(payload.task_id) : payload?.task?.id ? String(payload.task.id) : null;
  const clickupWebhookId: string | null = payload?.webhook_id ? String(payload.webhook_id) : null;
  const dedupeKey = buildDedupeKey(payload, rawBody);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: existing } = await supabase
    .from("clickup_webhook_events")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existing) {
    return json({ received: true, deduplicated: true });
  }

  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => { headersObj[k] = v; });

  const { data: webhookRow, error: webhookErr } = await supabase
    .from("clickup_webhook_events")
    .insert({
      clickup_webhook_id: clickupWebhookId,
      event_type: eventType,
      clickup_task_id: clickupTaskId,
      payload,
      headers: headersObj,
      dedupe_key: dedupeKey,
    })
    .select()
    .single();

  if (webhookErr) {
    console.error("[clickup-webhook] failed to store webhook event:", webhookErr.message);
    return err("Failed to store webhook event.", 500, "DB_ERROR", webhookErr.message);
  }

  const { projectId, taskLinkId } = await resolveProjectId(supabase, payload, clickupTaskId);

  if (!projectId) {
    await supabase
      .from("clickup_webhook_events")
      .update({ processing_error: "Could not map to OXUS project.", processed_at: new Date().toISOString() })
      .eq("id", webhookRow.id);
    return json({ received: true, mapped: false, code: "UNMAPPED" });
  }

  const isCommentEvent = eventType === "taskCommentPosted" || eventType === "taskCommentUpdated";
  const commentText = isCommentEvent ? extractCommentTextFromPayload(payload) : null;
  const commentMetadata = isCommentEvent ? extractCommentMetadataFromPayload(payload) : null;
  const needsCommentFetch = isCommentEvent && !commentText;

  let taskName = payload?.task?.name ?? "unknown task";
  if (taskLinkId) {
    const { data: link } = await supabase
      .from("clickup_task_links")
      .select("clickup_task_name")
      .eq("id", taskLinkId)
      .maybeSingle();
    if (link?.clickup_task_name) taskName = link.clickup_task_name;
  }

  const clickupDate = parseClickupDate(payload?.date ?? payload?.history_items?.[0]?.date);
  const actor = payload?.history_items?.[0]?.user ?? payload?.user ?? null;
  const timelineDedupeKey = `tl_${dedupeKey}`;
  const summary = eventSummary(eventType, payload, commentText, taskName);

  const timelinePayload = {
    ...payload,
    extracted_comment_text: commentText,
    needs_comment_fetch: needsCommentFetch,
    clickup_comment_id: commentMetadata?.clickup_comment_id ?? null,
    clickup_parent_comment_id: commentMetadata?.clickup_parent_comment_id ?? null,
    clickup_thread_id: commentMetadata?.clickup_thread_id ?? null,
    comment_text: commentText,
  };

  const { data: insertedTimeline, error: timelineErr } = await supabase
    .from("project_clickup_timeline_events")
    .insert({
      project_id: projectId,
      clickup_task_link_id: taskLinkId,
      clickup_task_id: clickupTaskId,
      clickup_comment_id: commentMetadata?.clickup_comment_id ?? null,
      clickup_parent_comment_id: commentMetadata?.clickup_parent_comment_id ?? null,
      clickup_thread_id: commentMetadata?.clickup_thread_id ?? null,
      comment_text: commentText,
      event_type: eventType,
      event_title: eventTitle(eventType),
      event_summary: summary,
      actor_name: actor?.username ?? actor?.email ?? null,
      actor_email: actor?.email ?? null,
      clickup_date: clickupDate,
      direction: "from_clickup",
      source: "webhook",
      raw_payload: timelinePayload,
      dedupe_key: timelineDedupeKey,
    })
    .select("*")
    .single();

  if (!timelineErr && insertedTimeline) {
    try {
      await syncClickupTimelineRowToUnified(supabase, insertedTimeline as Record<string, unknown>);
    } catch (e) {
      console.warn("[clickup-webhook] unified timeline sync failed:", (e as Error).message);
    }
  }

  const now = new Date().toISOString();
  const { data: projectLink } = await supabase
    .from("project_clickup_links")
    .select("id, metadata")
    .eq("project_id", projectId)
    .maybeSingle();

  if (projectLink) {
    await supabase
      .from("project_clickup_links")
      .update({
        last_sync_at: now,
        metadata: {
          ...(projectLink.metadata ?? {}),
          needs_ai_review: true,
          needs_comment_fetch: needsCommentFetch || (projectLink.metadata as any)?.needs_comment_fetch === true,
          last_webhook_received_at: now,
          last_webhook_event_type: eventType,
          last_webhook_mapped: !timelineErr,
          last_webhook_error: timelineErr?.message ?? null,
        },
      })
      .eq("id", projectLink.id);
  }

  if (taskLinkId && payload?.task) {
    const task = payload.task;
    await supabase
      .from("clickup_task_links")
      .update({
        clickup_status: task.status?.status ?? null,
        clickup_priority: task.priority?.priority ?? null,
        last_snapshot: task,
        last_synced_at: now,
      })
      .eq("id", taskLinkId);
  } else if (taskLinkId && isCommentEvent) {
    await supabase
      .from("clickup_task_links")
      .update({ last_synced_at: now })
      .eq("id", taskLinkId);
  }

  await supabase
    .from("clickup_webhook_events")
    .update({ processed_at: now, processing_error: timelineErr?.message ?? null })
    .eq("id", webhookRow.id);

  if (timelineErr) {
    return err("Webhook received but timeline insert failed.", 500, "DB_ERROR", timelineErr.message);
  }

  return json({
    received: true,
    mapped: true,
    event_type: eventType,
    has_comment_text: !!commentText,
    needs_comment_fetch: needsCommentFetch,
  });
});
