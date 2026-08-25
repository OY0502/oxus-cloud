import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { isTriggerDevConfigured, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { getAuthenticatedUser } from "../_shared/slack-auth.ts";
import { processAiJobsForProject, ensureSlackSignalsProcessed } from "../_shared/processAiJobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let body: { project_id?: string; limit?: number; ensure_pending?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const admin = getServiceRoleSupabase();
    const projectId = body.project_id?.trim();

    if (projectId) {
      const {
        getProjectArchiveState,
        isProjectArchived,
        PROJECT_ARCHIVED_SKIP_MESSAGE,
      } = await import("../_shared/projectArchive.ts");
      const archiveCheck = await getProjectArchiveState(admin, projectId);
      if (isProjectArchived(archiveCheck)) {
        console.log(`[process-ai-jobs] ${PROJECT_ARCHIVED_SKIP_MESSAGE}`);
        return json({
          skipped: true,
          reason: PROJECT_ARCHIVED_SKIP_MESSAGE,
          processed_count: 0,
          failed_count: 0,
          actions_created_count: 0,
          actions_updated_count: 0,
          actions_auto_resolved_count: 0,
          actions_skipped_count: 0,
          actions_suppressed_count: 0,
          timeline_events_created_count: 0,
          timeline_events_updated_count: 0,
          threads_checked: 0,
          duplicates_avoided: 0,
          noise_skipped_count: 0,
          signals_checked: 0,
          signals_new: 0,
          signals_already_processed: 0,
          reasons: [PROJECT_ARCHIVED_SKIP_MESSAGE],
          job_ids: [],
          suppression_reasons: [],
        });
      }
    }

    if (projectId && isTriggerDevConfigured() && body.async !== false) {
      try {
        const triggered = await triggerDevTask("process-project-signals", {
          project_id: projectId,
          user_id: auth.userId,
          limit: body.limit,
        });
        if (triggered?.id) {
          await admin.from("ai_processing_jobs").insert({
            project_id: projectId,
            job_type: "analyze_project_signals",
            status: "running",
            payload: { trigger_delegated: true },
            trigger_run_id: triggered.id,
            started_at: new Date().toISOString(),
          });
          return json({
            trigger_run_id: triggered.id,
            async: true,
            message: "AI job processing queued via Trigger.dev.",
          });
        }
      } catch (e) {
        console.warn("[process-ai-jobs] Trigger.dev failed, falling back:", (e as Error).message);
      }
    }

    const result = body.ensure_pending !== false && body.project_id
      ? await ensureSlackSignalsProcessed({
        admin,
        projectId: body.project_id.trim(),
        createdBy: auth.userId,
      })
      : await processAiJobsForProject({
        admin,
        projectId: body.project_id?.trim(),
        createdBy: auth.userId,
        limit: body.limit,
      });

    return json(result);
  } catch (e) {
    return err("Failed to process AI jobs.", 500, "PROCESS_JOBS_ERROR", (e as Error).message);
  }
});
