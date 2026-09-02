import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { shouldQueueTriggerDevTasks, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { assertInternalOxusUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
  const body = await req.json().catch(() => ({})) as { project_id?: string; force?: boolean };
  const projectId = body.project_id?.trim();
  if (!projectId) return json({ error: "project_id is required." }, 400);
  if (!shouldQueueTriggerDevTasks()) return json({ error: "Background ClickUp scanning is not configured." }, 503);

  const admin = getServiceRoleSupabase();
  const { data: link, error } = await admin.from("project_clickup_links").select("id, metadata, status, clickup_space_id")
    .eq("project_id", projectId).eq("status", "active").maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!link?.clickup_space_id) return json({ error: "An active ClickUp space link is required." }, 409);
  const metadata = object(link.metadata);
  const scanStatus = typeof metadata.initial_scan_status === "string" ? metadata.initial_scan_status : null;
  if (!body.force && (scanStatus === "queued" || scanStatus === "running" || scanStatus === "completed")) {
    return json({ status: scanStatus, queued: scanStatus !== "completed", trigger_run_id: metadata.initial_scan_trigger_run_id ?? null });
  }
  const attempt = Number(metadata.initial_scan_attempt ?? 0) + 1;
  const queuedAt = new Date().toISOString();
  const queuedMetadata = { ...metadata, initial_scan_status: "queued", initial_scan_attempt: attempt, initial_scan_queued_at: queuedAt };
  await admin.from("project_clickup_links").update({ last_error: null, metadata: queuedMetadata }).eq("id", link.id);
  try {
    const triggered = await triggerDevTask("clickup-initial-project-scan", { project_id: projectId, user_id: auth.userId, force: body.force === true }, {
      idempotencyKey: `clickup-initial-project-scan:${link.id}:${attempt}`,
    });
    await admin.from("project_clickup_links").update({ metadata: { ...queuedMetadata, initial_scan_trigger_run_id: triggered.id } }).eq("id", link.id);
    return json({ status: "queued", queued: true, trigger_run_id: triggered.id }, 202);
  } catch (triggerError) {
    const message = (triggerError as Error).message;
    await admin.from("project_clickup_links").update({
      last_error: message.slice(0, 1000), metadata: { ...queuedMetadata, initial_scan_status: "failed", initial_scan_failed_at: new Date().toISOString() },
    }).eq("id", link.id);
    return json({ error: "Initial ClickUp scan could not be queued.", details: message }, 503);
  }
});
