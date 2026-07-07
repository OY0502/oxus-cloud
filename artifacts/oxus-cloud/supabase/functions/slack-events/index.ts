import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { verifySlackSignature } from "../_shared/slack.ts";
import {
  slackMessageFromEvent,
  upsertProjectSlackEvent,
} from "../_shared/slackEventStore.ts";
import type { ProjectSlackLinkRow } from "../_shared/slack-auth.ts";

Deno.serve(async (req) => {
  const rawBody = await req.text();

  try {
    if (!(await verifySlackSignature(req, rawBody))) {
      return new Response(JSON.stringify({ error: "Invalid Slack signature.", code: "UNAUTHORIZED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    if (payload.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (payload.type !== "event_callback") {
      return new Response("ok", { status: 200 });
    }

    const event = payload.event as Record<string, unknown> | undefined;
    const teamId = typeof payload.team_id === "string" ? payload.team_id : null;
    if (!event || !teamId) return new Response("ok", { status: 200 });

    const eventType = typeof event.type === "string" ? event.type : "";
    if (eventType !== "message" && eventType !== "app_mention") {
      return new Response("ok", { status: 200 });
    }

    if (event.subtype === "message_deleted" || event.hidden) {
      return new Response("ok", { status: 200 });
    }

    const channelId = typeof event.channel === "string" ? event.channel : null;
    if (!channelId) return new Response("ok", { status: 200 });

    const admin = getServiceRoleSupabase();
    const { data: links } = await admin
      .from("project_slack_links")
      .select(
        "id, project_id, slack_team_id, slack_channel_id, channel_name, link_type, include_in_ai, include_in_client_updates, is_client_facing, status, ingest_from_ts, last_processed_ts, sync_mode, created_at",
      )
      .eq("slack_team_id", teamId)
      .eq("slack_channel_id", channelId)
      .eq("status", "active");

    if (!links || links.length === 0) {
      return new Response("ok", { status: 200 });
    }

    const message = slackMessageFromEvent(event, teamId);
    if (!message || message.is_bot_message) {
      return new Response("ok", { status: 200 });
    }

    for (const link of links as ProjectSlackLinkRow[]) {
      try {
        await upsertProjectSlackEvent({ admin, link, message });
        await admin
          .from("project_slack_links")
          .update({
            last_event_ts: message.slack_ts,
            last_synced_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", link.id);
      } catch (e) {
        console.warn("[slack-events] failed to store event:", (e as Error).message);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[slack-events]", (e as Error).message);
    return new Response("ok", { status: 200 });
  }
});
