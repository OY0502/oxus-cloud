import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CLICKUP_PRIORITY_OPTIONS,
  clickupFetch,
  fetchListStatuses,
  pickDefaultStatus,
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

    // Read the existing project ClickUp link (do NOT provision a space here).
    const { data: link } = await supabase
      .from("project_clickup_links")
      .select("clickup_list_id, clickup_folder_id, clickup_space_id")
      .eq("project_id", body.project_id)
      .maybeSingle();

    const listId = link?.clickup_list_id as string | undefined;
    if (!listId) {
      return json({
        linked: false,
        statuses: [],
        priorities: CLICKUP_PRIORITY_OPTIONS,
        destination: null,
        message:
          "This project is not linked to a ClickUp list yet. Sync the ClickUp structure before creating tasks.",
      });
    }

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(auth.user.id, body.project_id));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    let listDetails: Record<string, unknown> | null = null;
    try {
      listDetails = await clickupFetch(clickup, `/list/${listId}`) as Record<string, unknown>;
    } catch (e) {
      return err("Failed to load ClickUp list details.", 502, "CLICKUP_ERROR", (e as Error).message);
    }

    const statuses = await fetchListStatuses(clickup, listId);
    const folder = listDetails?.folder as { name?: string } | undefined;
    const space = listDetails?.space as { name?: string } | undefined;

    return json({
      linked: true,
      statuses,
      default_status: pickDefaultStatus(statuses) ?? null,
      priorities: CLICKUP_PRIORITY_OPTIONS,
      destination: {
        list_id: listId,
        list_name: typeof listDetails?.name === "string" ? listDetails.name : null,
        folder_name: folder?.name ?? null,
        space_name: space?.name ?? null,
      },
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Failed to list ClickUp statuses.", 502, "CLICKUP_ERROR", (e as Error).message);
  }
});
