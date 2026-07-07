import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getActiveSlackWorkspace, getAuthenticatedUser } from "../_shared/slack-auth.ts";
import { listSlackChannelsForBot } from "../_shared/slack.ts";

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
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let body: {
      slack_team_id?: string;
      query?: string;
      include_private?: boolean;
      ensure_channel_ids?: string[];
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const admin = getServiceRoleSupabase();
    const { workspace, token } = await getActiveSlackWorkspace(admin, body.slack_team_id?.trim());

    const ensureIds = Array.isArray(body.ensure_channel_ids)
      ? body.ensure_channel_ids.filter((id) => typeof id === "string" && id.trim())
      : [];

    const { channels, resolvedBotUserId } = await listSlackChannelsForBot(token, {
      botUserId: workspace.bot_user_id,
      includePrivate: body.include_private !== false,
      ensureChannelIds: ensureIds,
    });

    if (resolvedBotUserId && resolvedBotUserId !== workspace.bot_user_id) {
      await admin
        .from("slack_workspaces")
        .update({ bot_user_id: resolvedBotUserId, last_verified_at: new Date().toISOString() })
        .eq("id", workspace.id);
    }

    const query = body.query?.trim().toLowerCase() ?? "";
    const filtered = query
      ? channels.filter((ch) => ch.name.toLowerCase().includes(query) || ch.id.toLowerCase().includes(query))
      : channels;

    return json({ channels: filtered });
  } catch (e) {
    return err("Failed to list Slack channels.", 500, "SLACK_API_ERROR", (e as Error).message);
  }
});
