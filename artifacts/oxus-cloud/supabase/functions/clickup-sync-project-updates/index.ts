import { createClient } from "npm:@supabase/supabase-js@2";
import { syncProjectClickupUpdates } from "../_shared/syncProjectClickupUpdates.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
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
  if (status >= 500) console.error(`[${code}] ${message}`, details ?? "");
  return json({ error: message, details, code }, status);
}

function getAnonKey(): string | null {
  const key = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (key) return key;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    if (!supabaseUrl || !anonKey) return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    let body: { project_id?: string };
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }
    if (!body.project_id) return err("project_id is required.", 400, "INVALID_INPUT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth.user) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(auth.user.id, body.project_id));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const result = await syncProjectClickupUpdates({
      supabase,
      clickup,
      projectId: body.project_id,
      syncedVia: "clickup-sync-project-updates",
    });

    if (result.skipped && result.skip_reason === "Project is not linked to ClickUp.") {
      return err("Project is not linked to ClickUp.", 400, "CLICKUP_NOT_LINKED", result.skip_reason);
    }

    return json({
      imported_events_count: result.imported_events_count,
      checked_tasks_count: result.checked_tasks_count,
      comments_imported_count: result.comments_imported_count,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
