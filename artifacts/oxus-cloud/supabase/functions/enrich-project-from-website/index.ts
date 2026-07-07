import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getAuthenticatedUser } from "../_shared/slack-auth.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";
import {
  getTriggerKeyEnvironment,
  shouldQueueTriggerDevTasks,
  triggerDevEnvironmentWarning,
  triggerDevTask,
} from "../_shared/agent/triggerDev.ts";
import { normalizeWebsiteUrl, runProjectWebsiteEnrichment } from "../_shared/projectWebsiteEnrichment.ts";

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

type RequestBody = {
  project_id?: string;
  user_id?: string;
  company_website_url?: string | null;
  request_message?: string | null;
  proposal_id?: string | null;
  force?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");

    // Validate website format up front (empty is allowed — request_message-only runs).
    const rawWebsite = (body.company_website_url ?? "").trim();
    let normalizedWebsite: string | null = null;
    if (rawWebsite) {
      normalizedWebsite = normalizeWebsiteUrl(rawWebsite);
      if (!normalizedWebsite) {
        return err("company_website_url is not a valid URL.", 400, "INVALID_INPUT");
      }
    }

    const serviceRole = await isServiceRoleRequest(req);
    let userId = body.user_id?.trim();

    if (!serviceRole) {
      const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
      if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");
      userId = auth.userId;

      // Project access check via the caller's RLS-scoped client.
      const { data: project, error: projectError } = await auth.supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return err("Failed to verify project access.", 500, "DB_ERROR", projectError.message);
      if (!project) return err("Project was not found or is not accessible.", 404, "PROJECT_NOT_FOUND");
    } else if (!userId) {
      return err("user_id is required for service-role invocations.", 400, "INVALID_INPUT");
    }

    const requestMessage = (body.request_message ?? "").trim() || null;
    const proposalId = body.proposal_id?.trim() || null;
    const force = body.force === true;

    // Queue via Trigger.dev for user requests when a production key is configured.
    const queueViaTrigger = !serviceRole && shouldQueueTriggerDevTasks();
    const triggerWarning = triggerDevEnvironmentWarning();

    if (queueViaTrigger) {
      const admin = getServiceRoleSupabase();
      try {
        await admin
          .from("projects")
          .update({
            company_enrichment_status: "queued",
            company_enrichment_error: null,
            ...(normalizedWebsite ? { company_website_url: normalizedWebsite } : {}),
          })
          .eq("id", projectId);

        const triggered = await triggerDevTask("enrich-project-from-website", {
          project_id: projectId,
          user_id: userId,
          company_website_url: normalizedWebsite,
          request_message: requestMessage,
          proposal_id: proposalId,
          force,
        });

        if (triggered?.id) {
          // Record the run id for diagnostics (non-fatal if it fails).
          try {
            await admin
              .from("projects")
              .update({
                company_enrichment_metadata: {
                  queued_at: new Date().toISOString(),
                  trigger_run_id: triggered.id,
                  trigger_environment: getTriggerKeyEnvironment(),
                },
              })
              .eq("id", projectId);
          } catch (_e) {
            // ignore metadata bookkeeping failures
          }

          return json({
            trigger_run_id: triggered.id,
            trigger_environment: getTriggerKeyEnvironment(),
            async: true,
            status: "queued",
            message: "Company website enrichment queued via Trigger.dev.",
          });
        }
      } catch (e) {
        console.warn("[enrich-project-from-website] Trigger.dev failed, running inline:", (e as Error).message);
      }
    }

    // Inline execution (service-role worker call, or Trigger.dev not configured).
    const admin = getServiceRoleSupabase();
    const result = await runProjectWebsiteEnrichment({
      admin,
      projectId,
      userId: userId!,
      companyWebsiteUrl: normalizedWebsite,
      requestMessage,
      proposalId,
      force,
    });

    return json({
      ...result,
      async: false,
      trigger_environment: getTriggerKeyEnvironment(),
      fallback_used: !serviceRole && !!triggerWarning,
      warning: !serviceRole ? triggerWarning ?? undefined : undefined,
    });
  } catch (e) {
    return err("Company website enrichment failed.", 500, "ENRICHMENT_ERROR", (e as Error).message);
  }
});
