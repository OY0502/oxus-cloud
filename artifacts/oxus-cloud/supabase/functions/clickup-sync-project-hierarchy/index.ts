import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { syncClickupProjectHierarchy } from "../_shared/clickupHierarchy.ts";
import { isServiceRoleRequest } from "../_shared/serviceRoleAuth.ts";
import {
  assertInternalOxusUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

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
    let body: { project_id?: string; user_id?: string; force?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return err("project_id is required.", 400, "INVALID_INPUT");

    let userId = body.user_id?.trim();
    if (!(await isServiceRoleRequest(req))) {
      let auth;
      try {
        auth = await assertInternalOxusUser(req);
      } catch (e) {
        if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
        throw e;
      }
      userId = auth.userId;
    } else if (!userId) {
      return err("user_id is required for service-role invocations.", 400, "INVALID_INPUT");
    }

    const admin = getServiceRoleSupabase();
    const result = await syncClickupProjectHierarchy({
      admin,
      projectId,
      userId: userId!,
      force: body.force === true,
    });

    return json(result);
  } catch (e) {
    return err("ClickUp hierarchy sync failed.", 500, "HIERARCHY_SYNC_ERROR", (e as Error).message);
  }
});
