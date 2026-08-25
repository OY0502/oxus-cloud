import type { SupabaseClient } from "@supabase/supabase-js";

export type TriggerTaskResult = {
  id: string;
  url?: string;
  taskIdentifier?: string;
};

function parseTriggerRunId(parsed: Record<string, unknown>): string | null {
  const candidates = [
    parsed.id,
    (parsed.run as Record<string, unknown> | undefined)?.id,
    parsed.runId,
    parsed.handle,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export function isTriggerDevConfigured(): boolean {
  const key = process.env.TRIGGER_SECRET_KEY?.trim() ?? "";
  return key.startsWith("tr_prod_") || key.startsWith("tr_stg_");
}

export async function triggerDevTask(
  taskId: string,
  payload: Record<string, unknown>,
  options?: { idempotencyKey?: string },
): Promise<TriggerTaskResult> {
  const secretKey = process.env.TRIGGER_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Trigger.dev is not configured (TRIGGER_SECRET_KEY missing).");
  }

  const apiUrl = (process.env.TRIGGER_API_URL ?? "https://api.trigger.dev").replace(/\/+$/, "");
  const response = await fetch(`${apiUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/trigger`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey}`,
      ...(process.env.TRIGGER_PREVIEW_BRANCH?.trim()
        ? { "x-trigger-branch": process.env.TRIGGER_PREVIEW_BRANCH.trim() }
        : {}),
    },
    body: JSON.stringify({
      payload,
      ...(options?.idempotencyKey ? { options: { idempotencyKey: options.idempotencyKey } } : {}),
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Trigger.dev trigger failed (${response.status}): ${text.slice(0, 800)}`);
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  const runId = parseTriggerRunId(parsed);
  if (!runId) throw new Error("Trigger.dev response missing run id.");
  return { id: runId, taskIdentifier: taskId };
}

export async function loadImportRunForRecovery(
  admin: SupabaseClient,
  importRunId: string,
) {
  const { data, error } = await admin
    .from("google_import_runs")
    .select("id, connection_id, owner_user_id, correlation_id, status, progress_stage, core_sync_status, source_progress, processor_version, retry_count, recovery_status")
    .eq("id", importRunId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
