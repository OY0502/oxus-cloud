import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchClickupMembers,
  upsertClickupMembers,
} from "../_shared/clickup.ts";
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

    let body: { project_id?: string; force?: boolean };
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

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

    let listId: string | null = null;
    if (body.project_id) {
      const { data: link } = await supabase
        .from("project_clickup_links")
        .select("clickup_list_id, clickup_team_id")
        .eq("project_id", body.project_id)
        .maybeSingle();
      listId = link?.clickup_list_id ?? null;
    }

    const { members: fetched, source } = await fetchClickupMembers(clickup, listId);
    if (fetched.length === 0) {
      return err("No ClickUp members were returned from the API.", 502, "CLICKUP_ERROR", `source=${source}`);
    }

    const deactivateMissing = body.force === true && source !== "list";
    const syncedCount = await upsertClickupMembers(supabase, clickup.teamId, fetched, deactivateMissing);

    const { data: cached, error: loadErr } = await supabase
      .from("clickup_members")
      .select("*")
      .eq("clickup_team_id", clickup.teamId)
      .eq("is_active", true)
      .order("username");
    if (loadErr) return err("Members synced but failed to load cache.", 500, "DB_ERROR", loadErr.message);

    return json({
      members: cached ?? [],
      synced_count: syncedCount,
      source,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
