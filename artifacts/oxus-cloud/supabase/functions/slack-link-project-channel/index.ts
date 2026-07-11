import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getSlackWorkspaceTokenOrThrow } from "../_shared/slack-auth.ts";
import {
  assertInternalOxusUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { callSlackApi } from "../_shared/slack.ts";
import { slackTsNow } from "../_shared/memoryMerge.ts";

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

type LinkType = "internal" | "external" | "other";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    let auth;
    try {
      auth = await assertInternalOxusUser(req);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    let body: {
      project_id?: string;
      slack_team_id?: string;
      slack_channel_id?: string;
      link_type?: LinkType;
      link_label?: string;
      purpose?: string;
      include_in_ai?: boolean;
      include_in_client_updates?: boolean;
      is_client_facing?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }

    const projectId = body.project_id?.trim();
    const slackTeamId = body.slack_team_id?.trim();
    const slackChannelId = body.slack_channel_id?.trim();
    const linkType = body.link_type;
    if (!projectId || !slackTeamId || !slackChannelId || !linkType) {
      return err("project_id, slack_team_id, slack_channel_id, and link_type are required.", 400, "INVALID_INPUT");
    }
    if (!["internal", "external", "other"].includes(linkType)) {
      return err("Invalid link_type.", 400, "INVALID_INPUT");
    }

    const admin = getServiceRoleSupabase();
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError || !project) {
      return err("Project was not found.", 404, "PROJECT_NOT_FOUND", projectError?.message);
    }

    const { token } = await getSlackWorkspaceTokenOrThrow(admin, slackTeamId);
    const channelInfo = await callSlackApi<{ channel?: Record<string, unknown> }>(token, "conversations.info", {
      channel: slackChannelId,
    });
    const channel = channelInfo.channel ?? {};

    const isExtShared = !!channel.is_ext_shared;
    const isShared = !!channel.is_shared;
    const isPrivate = !!channel.is_private;
    const includeInAi = body.include_in_ai ?? true;
    let includeInClientUpdates = body.include_in_client_updates ?? false;
    let isClientFacing = body.is_client_facing ?? linkType === "external";

    if (linkType === "external" && body.is_client_facing !== false) {
      isClientFacing = true;
    }
    if (linkType === "internal" && includeInClientUpdates) {
      // allowed but UI warns
    }

    const ingestFromTs = slackTsNow();
    const row = {
      project_id: projectId,
      slack_team_id: slackTeamId,
      slack_channel_id: slackChannelId,
      channel_name: typeof channel.name === "string" ? channel.name : null,
      channel_type: typeof channel.is_private === "boolean" ? (channel.is_private ? "private" : "public") : null,
      is_private: isPrivate,
      is_shared: isShared,
      is_ext_shared: isExtShared,
      link_label: body.link_label?.trim() || null,
      link_type: linkType,
      purpose: body.purpose?.trim() || null,
      include_in_ai: includeInAi,
      include_in_client_updates: includeInClientUpdates,
      is_client_facing: isClientFacing,
      status: "active",
      last_error: null,
      ingest_from_ts: ingestFromTs,
      ignore_history_before_ts: new Date().toISOString(),
      sync_mode: "new_messages_only",
      created_by: auth.userId,
      metadata: { suggested_external: isExtShared || isShared },
    };

    const { data: existingLink } = await admin
      .from("project_slack_links")
      .select("id, ingest_from_ts")
      .eq("project_id", projectId)
      .eq("slack_team_id", slackTeamId)
      .eq("slack_channel_id", slackChannelId)
      .maybeSingle();

    const upsertRow = existingLink?.ingest_from_ts
      ? { ...row, ingest_from_ts: existingLink.ingest_from_ts, ignore_history_before_ts: undefined }
      : row;

    const { data: link, error: upsertError } = await admin
      .from("project_slack_links")
      .upsert(upsertRow, { onConflict: "project_id,slack_team_id,slack_channel_id" })
      .select("*")
      .single();
    if (upsertError) return err("Failed to link Slack channel.", 500, "DB_ERROR", upsertError.message);

    return json({ link });
  } catch (e) {
    return err("Failed to link Slack channel.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
