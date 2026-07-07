import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptClickupToken } from "./clickupTokenCrypto.ts";
import type { ClickupApiEnv } from "./clickup.ts";

export type ClickupAuthorizedTeam = {
  id: string;
  name: string;
  color?: string | null;
};

export type UserClickupConnectionRow = {
  id: string;
  user_id: string;
  clickup_user_id: string | null;
  clickup_username: string | null;
  clickup_email: string | null;
  access_token_encrypted: string;
  authorized_teams: ClickupAuthorizedTeam[];
  selected_team_id: string | null;
  selected_team_name: string | null;
  status: string;
};

export class ClickupAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public redirectTo?: string,
  ) {
    super(message);
    this.name = "ClickupAuthError";
  }
}

export function getClickupBaseUrl(): string {
  return (Deno.env.get("CLICKUP_API_BASE_URL") ?? "https://api.clickup.com/api/v2").replace(/\/+$/, "");
}

export function getServiceRoleSupabase() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

function parseAuthorizedTeams(value: unknown): ClickupAuthorizedTeam[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((team) => {
      if (!team || typeof team !== "object") return null;
      const row = team as Record<string, unknown>;
      const id = row.id ?? row.team_id;
      if (id === undefined || id === null) return null;
      return {
        id: String(id),
        name: typeof row.name === "string" ? row.name : String(id),
        color: typeof row.color === "string" ? row.color : null,
      };
    })
    .filter((team): team is ClickupAuthorizedTeam => team !== null);
}

function teamIsAuthorized(connection: UserClickupConnectionRow, teamId: string): boolean {
  return parseAuthorizedTeams(connection.authorized_teams).some((team) => team.id === String(teamId));
}

export async function getCurrentUserClickupTokenOrThrow(
  userId: string,
  options?: { requiredTeamId?: string | null },
): Promise<{ clickup: ClickupApiEnv; connection: UserClickupConnectionRow }> {
  const admin = getServiceRoleSupabase();
  const { data: connection, error } = await admin
    .from("user_clickup_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!connection?.access_token_encrypted) {
    throw new ClickupAuthError(
      "Connect your ClickUp account first.",
      "CLICKUP_OAUTH_REQUIRED",
      401,
      "/settings?connect=clickup",
    );
  }

  const row = connection as UserClickupConnectionRow;
  const requiredTeamId = options?.requiredTeamId?.trim() || null;
  const teamId = requiredTeamId ?? row.selected_team_id;

  if (!teamId) {
    throw new ClickupAuthError(
      "Your ClickUp connection has no selected workspace.",
      "CLICKUP_OAUTH_REQUIRED",
      401,
      "/settings?connect=clickup",
    );
  }

  if (requiredTeamId && !teamIsAuthorized(row, requiredTeamId)) {
    throw new ClickupAuthError(
      "Your connected ClickUp account does not have access to this workspace.",
      "CLICKUP_TEAM_NOT_AUTHORIZED",
      403,
      "/settings?connect=clickup",
    );
  }

  let apiToken: string;
  try {
    apiToken = await decryptClickupToken(row.access_token_encrypted);
  } catch (e) {
    throw new ClickupAuthError(
      "Your ClickUp connection could not be verified. Please reconnect.",
      "CLICKUP_OAUTH_REQUIRED",
      401,
      "/settings?connect=clickup",
    );
  }

  return {
    clickup: {
      apiToken,
      teamId: String(teamId),
      baseUrl: getClickupBaseUrl(),
    },
    connection: row,
  };
}

export async function resolveUserClickupForProject(
  userId: string,
  projectId?: string | null,
): Promise<{ clickup: ClickupApiEnv; connection: UserClickupConnectionRow }> {
  let requiredTeamId: string | null = null;
  if (projectId) {
    const admin = getServiceRoleSupabase();
    const { data: link } = await admin
      .from("project_clickup_links")
      .select("clickup_team_id")
      .eq("project_id", projectId)
      .maybeSingle();
    requiredTeamId = link?.clickup_team_id ?? null;
  }
  return getCurrentUserClickupTokenOrThrow(userId, { requiredTeamId });
}

export function clickupAuthErrorResponse(
  error: ClickupAuthError,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: error.message,
      code: error.code,
      redirect_to: error.redirectTo,
    }),
    {
      status: error.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export async function loadOxusActorProfile(userId: string): Promise<{ full_name: string | null; email: string | null }> {
  const admin = getServiceRoleSupabase();
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return {
    full_name: data?.full_name ?? null,
    email: data?.email ?? null,
  };
}
