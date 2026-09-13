import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!(await isServiceRoleRequest(req))) return json({ error: "Forbidden." }, 403);

  const body = await req.json().catch(() => ({})) as { batch_id?: string; include_failed?: boolean };
  const batchId = body.batch_id?.trim();
  if (!batchId) return json({ error: "batch_id is required." }, 400);

  const admin = getServiceRoleSupabase();
  const { data: batch, error: batchError } = await admin
    .from("project_meeting_ingestion_batches")
    .select("id, project_id, created_by, chat_session_id, status")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) return json({ error: batchError.message }, 500);
  if (!batch?.created_by || !batch.chat_session_id) return json({ error: "Meeting batch not found." }, 404);
  if (batch.status === "queued" || batch.status === "processing") {
    return json({ error: "Meeting batch is already running." }, 409);
  }

  const { data: items, error: itemsError } = await admin
    .from("project_meeting_ingestion_items")
    .select("id, status")
    .eq("batch_id", batchId);
  if (itemsError) return json({ error: itemsError.message }, 500);
  const retryableStatuses = body.include_failed ? new Set(["queued", "failed"]) : new Set(["queued"]);
  const retryIds = (items ?? []).filter((item) => retryableStatuses.has(item.status)).map((item) => item.id);
  if (!retryIds.length) return json({ error: "Meeting batch has no retryable files." }, 409);
  const completedCount = (items ?? []).filter((item) => item.status === "completed").length;
  const failedCount = (items ?? []).filter((item) => item.status === "failed").length;
  const progress = items?.length ? Math.round(((completedCount + failedCount) / items.length) * 100) : 0;

  const { error: resetError } = await admin
    .from("project_meeting_ingestion_items")
    .update({
      status: "queued",
      progress_percent: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
    })
    .in("id", retryIds);
  if (resetError) return json({ error: resetError.message }, 500);

  await admin.from("project_meeting_ingestion_batches").update({
    status: "queued",
    progress_percent: progress,
    completed_count: completedCount,
    failed_count: failedCount,
    error_message: null,
    started_at: null,
    completed_at: null,
  }).eq("id", batchId);

  try {
    const triggered = await triggerDevTask("project-meeting-batch", {
      batch_id: batch.id,
      project_id: batch.project_id,
      user_id: batch.created_by,
      chat_session_id: batch.chat_session_id,
    }, { idempotencyKey: `project-meeting-batch-retry:${batch.id}:${Date.now()}` });
    await admin.from("project_meeting_ingestion_batches").update({ trigger_run_id: triggered.id }).eq("id", batchId);
    return json({ ok: true, batch_id: batchId, trigger_run_id: triggered.id, retried_file_count: retryIds.length }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("project_meeting_ingestion_batches").update({
      status: "failed",
      error_message: message.slice(0, 1000),
      completed_at: new Date().toISOString(),
    }).eq("id", batchId);
    return json({ error: "Could not restart meeting processing." }, 503);
  }
});
