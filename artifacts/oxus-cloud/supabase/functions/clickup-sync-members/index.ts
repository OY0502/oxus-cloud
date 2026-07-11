import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchClickupAssignableMembersForTarget,
  fetchClickupMembers,
  upsertClickupMembers,
  upsertProjectClickupAssignableMembers,
} from "../_shared/clickup.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusAuthUser,
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
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    let clickup;
    try {
      ({ clickup } = await resolveUserClickupForProject(userId, body.project_id));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    let projectLink: {
      clickup_list_id: string | null;
      clickup_team_id: string;
      clickup_space_id: string | null;
      clickup_folder_id: string | null;
      space_name: string | null;
      folder_name: string | null;
      list_name: string | null;
      metadata: Record<string, unknown> | null;
    } | null = null;

    if (body.project_id) {
      const { data: link } = await supabase
        .from("project_clickup_links")
        .select(
          "clickup_list_id, clickup_team_id, clickup_space_id, clickup_folder_id, space_name, folder_name, list_name, metadata",
        )
        .eq("project_id", body.project_id)
        .maybeSingle();
      projectLink = link ?? null;
    }

    const { members: workspaceMembers, source: workspaceSource } = await fetchClickupMembers(clickup);
    if (workspaceMembers.length === 0) {
      return err("No ClickUp workspace members were returned from the API.", 502, "CLICKUP_ERROR", `source=${workspaceSource}`);
    }

    const workspaceSyncedCount = await upsertClickupMembers(
      supabase,
      clickup.teamId,
      workspaceMembers,
      body.force === true,
    );

    let assignableSyncedCount = 0;
    let assignableSource = "fallback";
    let assignableConfidence: "high" | "medium" | "low" = "low";
    let assignableMembers: Array<Record<string, unknown>> = [];

    if (body.project_id && projectLink) {
      const assignableResult = await fetchClickupAssignableMembersForTarget(clickup, {
        listId: projectLink.clickup_list_id,
        spaceId: projectLink.clickup_space_id,
        folderId: projectLink.clickup_folder_id,
      });
      assignableSource = assignableResult.source;
      assignableConfidence = assignableResult.confidence;

      assignableSyncedCount = await upsertProjectClickupAssignableMembers(
        supabase,
        body.project_id,
        {
          teamId: clickup.teamId,
          spaceId: projectLink.clickup_space_id,
          folderId: projectLink.clickup_folder_id,
          listId: projectLink.clickup_list_id,
        },
        assignableResult,
      );

      const { data: assignableRows, error: assignableLoadErr } = await supabase
        .from("project_clickup_assignable_members")
        .select("*")
        .eq("project_id", body.project_id)
        .eq("is_assignable", true)
        .order("name");
      if (assignableLoadErr) {
        return err("Assignable members synced but failed to load cache.", 500, "DB_ERROR", assignableLoadErr.message);
      }
      assignableMembers = assignableRows ?? [];

      const diagnostics = {
        workspace_member_count: workspaceMembers.length,
        assignable_member_count: assignableMembers.length,
        hidden_workspace_member_count: Math.max(0, workspaceMembers.length - assignableMembers.length),
        sync_source: assignableSource,
        confidence: assignableConfidence,
        linked_space_id: projectLink.clickup_space_id,
        linked_space_name: projectLink.space_name,
        linked_folder_id: projectLink.clickup_folder_id,
        linked_folder_name: projectLink.folder_name,
        linked_list_id: projectLink.clickup_list_id,
        linked_list_name: projectLink.list_name,
        last_synced_at: new Date().toISOString(),
      };

      const existingMetadata =
        projectLink.metadata && typeof projectLink.metadata === "object" && !Array.isArray(projectLink.metadata)
          ? projectLink.metadata
          : {};

      await supabase
        .from("project_clickup_links")
        .update({
          metadata: {
            ...existingMetadata,
            assignable_members_sync: diagnostics,
          },
        })
        .eq("project_id", body.project_id);
    }

    const { data: cached, error: loadErr } = await supabase
      .from("clickup_members")
      .select("*")
      .eq("clickup_team_id", clickup.teamId)
      .eq("is_active", true)
      .order("username");
    if (loadErr) return err("Members synced but failed to load workspace cache.", 500, "DB_ERROR", loadErr.message);

    return json({
      members: cached ?? [],
      assignable_members: assignableMembers,
      synced_count: workspaceSyncedCount,
      assignable_synced_count: assignableSyncedCount,
      source: workspaceSource,
      assignable_source: assignableSource,
      diagnostics: body.project_id && projectLink
        ? {
            workspace_member_count: workspaceMembers.length,
            assignable_member_count: assignableMembers.length,
            hidden_workspace_member_count: Math.max(0, workspaceMembers.length - assignableMembers.length),
            sync_source: assignableSource,
            confidence: assignableConfidence,
            linked_space_id: projectLink.clickup_space_id,
            linked_space_name: projectLink.space_name,
            linked_folder_id: projectLink.clickup_folder_id,
            linked_folder_name: projectLink.folder_name,
            linked_list_id: projectLink.clickup_list_id,
            linked_list_name: projectLink.list_name,
          }
        : null,
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
