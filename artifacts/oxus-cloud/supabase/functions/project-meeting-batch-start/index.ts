import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { shouldQueueTriggerDevTasks, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { assertInternalOxusUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_FILES = 20;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_BATCH_BYTES = 3 * 1024 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["txt", "md", "csv", "json", "vtt", "srt", "mp3", "mp4", "m4a", "wav", "webm", "ogg", "oga", "aac", "flac", "mov", "mpeg", "mpg"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let auth;
  try {
    auth = await assertInternalOxusUser(req);
  } catch (error) {
    if (error instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(error, corsHeaders);
    throw error;
  }
  const body = await req.json().catch(() => ({})) as {
    project_id?: string; chat_session_id?: string; attachment_ids?: string[]; message?: string;
  };
  const projectId = body.project_id?.trim();
  const attachmentIds = [...new Set((body.attachment_ids ?? []).filter((id) => typeof id === "string" && id.trim()))];
  if (!projectId) return json({ error: "project_id is required." }, 400);
  if (!attachmentIds.length || attachmentIds.length > MAX_FILES) return json({ error: `Choose between 1 and ${MAX_FILES} meeting files.` }, 400);
  if (!shouldQueueTriggerDevTasks()) return json({ error: "Background meeting processing is not configured." }, 503);

  const admin = getServiceRoleSupabase();
  const { data: project } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return json({ error: "Project not found." }, 404);
  const { data: attachments, error: attachmentError } = await admin.from("attachments")
    .select("id, file_name, file_path, file_size, mime_type")
    .in("id", attachmentIds).eq("entity_type", "project").eq("entity_id", projectId);
  if (attachmentError) return json({ error: attachmentError.message }, 500);
  if ((attachments ?? []).length !== attachmentIds.length) return json({ error: "One or more uploaded files do not belong to this project." }, 400);
  let totalBytes = 0;
  for (const attachment of attachments ?? []) {
    const size = Number(attachment.file_size ?? 0);
    const extension = String(attachment.file_name ?? "").split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(extension)) return json({ error: `${attachment.file_name} is not a supported recording or transcript.` }, 400);
    if (size > MAX_FILE_BYTES) return json({ error: `${attachment.file_name} exceeds the 1 GB per-file limit.` }, 413);
    totalBytes += size;
  }
  if (totalBytes > MAX_BATCH_BYTES) return json({ error: "This batch exceeds the 3 GB total limit." }, 413);

  let sessionId = body.chat_session_id?.trim();
  if (sessionId) {
    const { data: session } = await admin.from("project_chat_sessions").select("id").eq("id", sessionId).eq("project_id", projectId).maybeSingle();
    if (!session) return json({ error: "Chat session not found." }, 404);
  } else {
    const { data: session, error } = await admin.from("project_chat_sessions").insert({
      project_id: projectId, created_by: auth.userId, title: "Meeting import",
    }).select("id").single();
    if (error || !session) return json({ error: error?.message ?? "Could not create chat." }, 500);
    sessionId = String(session.id);
  }

  const message = body.message?.trim() || `Import and analyze ${attachmentIds.length} meeting recording${attachmentIds.length === 1 ? "" : "s"}.`;
  const { data: batch, error: batchError } = await admin.from("project_meeting_ingestion_batches").insert({
    project_id: projectId, chat_session_id: sessionId, created_by: auth.userId,
    file_count: attachmentIds.length, user_message: message, metadata: { total_bytes: totalBytes },
  }).select("id").single();
  if (batchError || !batch) return json({ error: batchError?.message ?? "Could not create meeting import." }, 500);
  const batchId = String(batch.id);
  const { error: itemsError } = await admin.from("project_meeting_ingestion_items").insert((attachments ?? []).map((attachment) => ({
    batch_id: batchId, project_id: projectId, attachment_id: attachment.id,
    file_name: attachment.file_name, mime_type: attachment.mime_type, file_size: attachment.file_size,
    metadata: { file_path: attachment.file_path },
  })));
  if (itemsError) {
    await admin.from("project_meeting_ingestion_batches").update({ status: "failed", error_message: itemsError.message, completed_at: new Date().toISOString() }).eq("id", batchId);
    return json({ error: itemsError.message }, 500);
  }
  await admin.from("project_chat_messages").insert({
    project_id: projectId, chat_session_id: sessionId, user_id: auth.userId, role: "user", content: message,
    metadata: { meeting_ingestion_batch_id: batchId, file_count: attachmentIds.length, background_processing: true },
  });
  try {
    const triggered = await triggerDevTask("project-meeting-batch", {
      batch_id: batchId, project_id: projectId, user_id: auth.userId, chat_session_id: sessionId,
    }, { idempotencyKey: `project-meeting-batch:${batchId}` });
    await admin.from("project_meeting_ingestion_batches").update({ trigger_run_id: triggered.id }).eq("id", batchId);
    return json({ batch_id: batchId, chat_session_id: sessionId, trigger_run_id: triggered.id, async: true }, 202);
  } catch (error) {
    const errorMessage = (error as Error).message;
    await admin.from("project_meeting_ingestion_batches").update({ status: "failed", error_message: errorMessage.slice(0, 1000), completed_at: new Date().toISOString() }).eq("id", batchId);
    return json({ error: "Meeting files were uploaded, but background processing could not be started.", details: errorMessage }, 503);
  }
});
