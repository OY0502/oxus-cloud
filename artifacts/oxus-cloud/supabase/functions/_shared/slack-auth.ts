import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptSlackBotToken } from "./slackTokenCrypto.ts";
import { getServiceRoleSupabase } from "./clickup-auth.ts";

export type SlackWorkspaceRow = {
  id: string;
  slack_team_id: string;
  slack_team_name: string | null;
  bot_user_id: string | null;
  bot_access_token_encrypted: string | null;
  status: string;
};

export function getSlackApiBaseUrl(): string {
  return (Deno.env.get("SLACK_API_BASE_URL") ?? "https://slack.com/api").replace(/\/+$/, "");
}

export function getSlackAppUrl(): string {
  return (Deno.env.get("SLACK_APP_URL") ?? "http://localhost:5173").replace(/\/+$/, "");
}

export async function getAuthenticatedUser(
  authHeader: string | null,
): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (!supabaseUrl || !anonKey) return null;
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: auth, error } = await supabase.auth.getUser(token);
  if (error || !auth.user) return null;
  return { supabase, userId: auth.user.id };
}

export async function requireSuperAdmin(userId: string): Promise<boolean> {
  const admin = getServiceRoleSupabase();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return profile?.role === "super_admin";
}

export async function getSlackWorkspaceTokenOrThrow(
  admin: SupabaseClient,
  slackTeamId: string,
): Promise<{ workspace: SlackWorkspaceRow; token: string }> {
  const { data: workspace, error } = await admin
    .from("slack_workspaces")
    .select("id, slack_team_id, slack_team_name, bot_user_id, bot_access_token_encrypted, status")
    .eq("slack_team_id", slackTeamId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !workspace?.bot_access_token_encrypted) {
    throw new Error(`Slack workspace ${slackTeamId} is not connected or active.`);
  }
  const token = await decryptSlackBotToken(workspace.bot_access_token_encrypted);
  return { workspace: workspace as SlackWorkspaceRow, token };
}

export async function getActiveSlackWorkspace(
  admin: SupabaseClient,
  slackTeamId?: string,
): Promise<{ workspace: SlackWorkspaceRow; token: string }> {
  let query = admin
    .from("slack_workspaces")
    .select("id, slack_team_id, slack_team_name, bot_user_id, bot_access_token_encrypted, status")
    .eq("status", "active")
    .order("connected_at", { ascending: false })
    .limit(1);
  if (slackTeamId) query = query.eq("slack_team_id", slackTeamId);
  const { data: workspace, error } = await query.maybeSingle();
  if (error || !workspace?.bot_access_token_encrypted) {
    throw new Error("No active Slack workspace is connected.");
  }
  const token = await decryptSlackBotToken(workspace.bot_access_token_encrypted);
  return { workspace: workspace as SlackWorkspaceRow, token };
}

export type ProjectSlackLinkRow = {
  id: string;
  project_id: string;
  slack_team_id: string;
  slack_channel_id: string;
  channel_name: string | null;
  link_type: "internal" | "external" | "other";
  include_in_ai: boolean;
  include_in_client_updates: boolean;
  is_client_facing: boolean;
  status: string;
  ingest_from_ts?: string | null;
  last_processed_ts?: string | null;
  sync_mode?: string | null;
  created_at?: string | null;
};
