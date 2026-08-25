import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ClickupApiEnv } from "./clickup.ts";
import { clickupFetch } from "./clickup.ts";

function fieldLabel(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["status", "name", "label", "value"]) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  return null;
}

function statusDisplay(value: string | null): string {
  if (!value) return "Unknown";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactComment(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
}

export async function repairMalformedClickupTimeline(args: {
  admin: SupabaseClient;
  clickup: ClickupApiEnv;
  projectId: string;
}): Promise<number> {
  const { data: candidates, error: candidateError } = await args.admin
    .from("project_timeline_events")
    .select("id, source_id, event_type, event_summary, event_body, metadata, related_clickup_task_id")
    .eq("project_id", args.projectId)
    .eq("source_type", "clickup")
    .eq("source_table", "project_clickup_timeline_events")
    .order("created_at", { ascending: false })
    .limit(100);
  if (candidateError) throw new Error(candidateError.message);

  const malformed = (candidates ?? []).filter((event) =>
    /unknown task|\[object Object\]/i.test(String(event.event_summary ?? ""))
  );
  if (malformed.length === 0) return 0;

  const sourceIds = malformed.map((event) => event.source_id).filter(Boolean);
  const { data: sourceRows } = sourceIds.length > 0
    ? await args.admin
      .from("project_clickup_timeline_events")
      .select("id, raw_payload")
      .in("id", sourceIds)
    : { data: [] as Array<{ id: string; raw_payload: unknown }> };
  const sourceById = new Map((sourceRows ?? []).map((row) => [String(row.id), row]));

  const taskIds = [...new Set(malformed.map((event) => String(event.related_clickup_task_id ?? "")).filter(Boolean))];
  const taskEntries = await Promise.all(taskIds.map(async (taskId) => {
    try {
      const task = await clickupFetch(args.clickup, `/task/${encodeURIComponent(taskId)}`) as Record<string, unknown>;
      return [taskId, {
        name: typeof task.name === "string" ? task.name : `ClickUp task ${taskId}`,
        url: typeof task.url === "string" ? task.url : `https://app.clickup.com/t/${taskId}`,
      }] as const;
    } catch {
      return [taskId, { name: `ClickUp task ${taskId}`, url: `https://app.clickup.com/t/${taskId}` }] as const;
    }
  }));
  const taskById = new Map(taskEntries);

  let repairedCount = 0;
  for (const event of malformed) {
    const taskId = String(event.related_clickup_task_id ?? "");
    const task = taskById.get(taskId);
    if (!task) continue;
    const source = sourceById.get(String(event.source_id ?? ""));
    const rawPayload = source?.raw_payload && typeof source.raw_payload === "object"
      ? source.raw_payload as Record<string, unknown>
      : {};
    const history = Array.isArray(rawPayload.history_items) && rawPayload.history_items[0]
      ? rawPayload.history_items[0] as Record<string, unknown>
      : {};
    const before = fieldLabel(history.before);
    const after = fieldLabel(history.after);
    const isStatus = /status/i.test(String(event.event_type));
    const isComment = /comment/i.test(String(event.event_type));

    let summary = String(event.event_summary ?? "").replace(/unknown task/gi, task.name);
    if (isStatus && (before || after)) {
      summary = `Task “${task.name}” changed from ${statusDisplay(before)} to ${statusDisplay(after)}.`;
    } else if (isComment && event.event_body) {
      const verb = /updated/i.test(String(event.event_type)) ? "updated" : "added";
      summary = `Comment “${compactComment(String(event.event_body))}” was ${verb} on task “${task.name}”.`;
    }

    const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown>
      : {};
    await args.admin.from("project_timeline_events").update({
      event_summary: summary,
      source_url: task.url,
      metadata: { ...metadata, task_name: task.name, before_status: before, after_status: after },
    }).eq("id", event.id);

    if (source?.id) {
      await args.admin.from("project_clickup_timeline_events").update({
        event_summary: summary,
        raw_payload: {
          ...rawPayload,
          task: {
            ...(rawPayload.task && typeof rawPayload.task === "object" ? rawPayload.task as Record<string, unknown> : {}),
            id: taskId,
            name: task.name,
            url: task.url,
          },
        },
      }).eq("id", source.id);
    }
    repairedCount += 1;
  }
  return repairedCount;
}
