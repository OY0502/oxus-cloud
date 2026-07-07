import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { mergeClickupDocsIntoProjectMemory } from "../_shared/clickupDocMemoryMerge.ts";
import { isTriggerDevConfigured, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";
import { getAuthenticatedUser } from "../_shared/slack-auth.ts";

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
    let body: {
      project_id?: string;
      user_id?: string;
      source_ids?: string[];
      docs_imported?: number;
      docs_updated?: number;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");

    const serviceRole = await isServiceRoleRequest(req);
    let userId = body.user_id?.trim();
    if (!serviceRole) {
      const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
      if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");
      userId = auth.userId;
    } else if (!userId) {
      return err("user_id is required for service-role invocations.", 400, "INVALID_INPUT");
    }

    const sourceIds = Array.isArray(body.source_ids)
      ? body.source_ids.filter((id): id is string => typeof id === "string" && !!id.trim())
      : [];

    if (!serviceRole && isTriggerDevConfigured()) {
      try {
        const triggered = await triggerDevTask("merge-project-memory-from-docs", {
          project_id: projectId,
          user_id: userId,
          source_ids: sourceIds,
          docs_imported: body.docs_imported ?? 0,
          docs_updated: body.docs_updated ?? 0,
        });
        return json({ trigger_run_id: triggered.id, async: true });
      } catch (e) {
        console.warn("[merge-project-memory-from-docs] Trigger.dev failed:", (e as Error).message);
      }
    }

    const admin = getServiceRoleSupabase();
    const result = await mergeClickupDocsIntoProjectMemory({
      admin,
      projectId,
      userId: userId!,
      sourceIds,
      docsImported: body.docs_imported ?? 0,
      docsUpdated: body.docs_updated ?? 0,
    });

    return json({ ...result, async: false });
  } catch (e) {
    return err("ClickUp docs memory merge failed.", 500, "CLICKUP_DOCS_MEMORY_ERROR", (e as Error).message);
  }
});
