import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { embedProjectKnowledgeChunks } from "../_shared/agent/retrieval.ts";
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
    const serviceRole = await isServiceRoleRequest(req);

    let body: { project_id?: string; source_id?: string; force?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");

    if (!serviceRole) {
      const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
      if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");
    }

    const payload = {
      project_id: projectId,
      source_id: body.source_id,
      force: body.force === true,
    };

    if (!serviceRole && isTriggerDevConfigured()) {
      try {
        const triggered = await triggerDevTask("embed-project-knowledge", payload);
        return json({
          trigger_run_id: triggered.id,
          async: true,
          warning: null,
        });
      } catch (e) {
        console.warn("[embed-project-knowledge] Trigger.dev failed:", (e as Error).message);
      }
    }

    const admin = getServiceRoleSupabase();
    const result = await embedProjectKnowledgeChunks({
      admin,
      projectId,
      sourceId: body.source_id,
      force: body.force,
    });

    return json({
      ...result,
      async: false,
      warning: result.embedding_skipped
        ? "Embeddings disabled, using fallback retrieval."
        : isTriggerDevConfigured() && !serviceRole
        ? null
        : "Trigger.dev not configured — ran synchronously.",
    });
  } catch (e) {
    return err("Embedding failed.", 500, "EMBED_ERROR", (e as Error).message);
  }
});
