import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getSlackAppUrl } from "../_shared/slack-auth.ts";
import { encryptSlackBotToken, hasSlackBotTokenEncryptionKey } from "../_shared/slackTokenCrypto.ts";

function buildAppUrl(path: string): string {
  return `${getSlackAppUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function redirectTo(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: buildAppUrl(path), "Cache-Control": "no-store" },
  });
}

function redirectError(message: string): Response {
  return redirectTo(`/settings?slack=error&message=${encodeURIComponent(message.slice(0, 500))}`);
}

function redirectSuccess(): Response {
  return redirectTo("/settings?slack=connected");
}

async function exchangeCodeForToken(code: string): Promise<Record<string, unknown>> {
  const clientId = Deno.env.get("SLACK_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET")?.trim();
  const redirectUri = Deno.env.get("SLACK_OAUTH_REDIRECT_URI")?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Slack OAuth is not configured on the server.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await resp.json();
  if (!payload.ok) {
    const slackError = String(payload.error ?? "unknown error");
    if (slackError === "bad_client_secret") {
      throw new Error(
        "Slack token exchange failed: bad_client_secret. " +
          "SLACK_CLIENT_SECRET in Supabase secrets must match SLACK_CLIENT_ID from the same Slack app " +
          "(Basic Information → App Credentials → Client Secret). Do not use the Signing Secret.",
      );
    }
    throw new Error(`Slack token exchange failed: ${slackError}`);
  }
  return payload as Record<string, unknown>;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) return redirectError("Missing OAuth code or state.");

    if (!hasSlackBotTokenEncryptionKey()) {
      return redirectError("Slack token encryption is not configured on the server.");
    }

    const admin = getServiceRoleSupabase();
    const { data: oauthState, error: stateErr } = await admin
      .from("slack_oauth_states")
      .select("*")
      .eq("state", state)
      .maybeSingle();
    if (stateErr || !oauthState) return redirectError("Invalid OAuth state.");

    if (oauthState.status !== "pending") {
      const { data: workspace } = await admin
        .from("slack_workspaces")
        .select("status")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (workspace?.status === "active") return redirectSuccess();
      return redirectError("OAuth session was already used. Please connect Slack again from Settings.");
    }

    if (new Date(oauthState.expires_at).getTime() < Date.now()) {
      await admin.from("slack_oauth_states").update({ status: "expired" }).eq("id", oauthState.id);
      return redirectError("OAuth session expired. Please try again.");
    }

    let payload: Record<string, unknown>;
    try {
      payload = await exchangeCodeForToken(code);
    } catch (e) {
      await admin
        .from("slack_oauth_states")
        .update({ status: "failed", used_at: new Date().toISOString() })
        .eq("id", oauthState.id);
      return redirectError((e as Error).message);
    }

    const team = payload.team as Record<string, unknown> | undefined;
    const slackTeamId = team?.id ? String(team.id) : null;
    const slackTeamName = typeof team?.name === "string" ? team.name : null;
    const bot = payload.access_token ? payload : (payload.bot as Record<string, unknown> | undefined);
    const botToken = typeof payload.access_token === "string"
      ? payload.access_token
      : typeof (payload.bot as Record<string, unknown>)?.bot_access_token === "string"
      ? (payload.bot as Record<string, unknown>).bot_access_token as string
      : null;
    const botUserId = typeof payload.bot_user_id === "string"
      ? payload.bot_user_id
      : typeof (payload.bot as Record<string, unknown>)?.bot_user_id === "string"
      ? (payload.bot as Record<string, unknown>).bot_user_id as string
      : null;
    const scopeRaw = typeof payload.scope === "string" ? payload.scope : "";
    const scopes = scopeRaw.split(",").map((s) => s.trim()).filter(Boolean);

    if (!slackTeamId || !botToken) {
      return redirectError("Slack OAuth response did not include team or bot token.");
    }

    let resolvedBotUserId = botUserId;
    if (!resolvedBotUserId) {
      try {
        const authTestResp = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${botToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });
        const authTest = await authTestResp.json();
        if (authTest.ok && typeof authTest.user_id === "string") {
          resolvedBotUserId = authTest.user_id;
        }
      } catch {
        // non-fatal; channel listing will retry auth.test later
      }
    }

    const encryptedToken = await encryptSlackBotToken(botToken);
    const now = new Date().toISOString();

    const { error: upsertErr } = await admin.from("slack_workspaces").upsert(
      {
        slack_team_id: slackTeamId,
        slack_team_name: slackTeamName,
        bot_user_id: resolvedBotUserId,
        bot_access_token_encrypted: encryptedToken,
        installing_user_id: oauthState.user_id,
        status: "active",
        scopes,
        connected_at: now,
        last_verified_at: now,
        last_error: null,
        updated_at: now,
      },
      { onConflict: "slack_team_id" },
    );
    if (upsertErr) {
      await admin.from("slack_oauth_states").update({ status: "failed", used_at: now }).eq("id", oauthState.id);
      return redirectError(`Failed to save Slack workspace: ${upsertErr.message}`);
    }

    await admin.from("slack_oauth_states").update({ status: "used", used_at: now }).eq("id", oauthState.id);
    return redirectSuccess();
  } catch (e) {
    console.error("[slack-oauth-callback]", (e as Error).message);
    return redirectError((e as Error).message || "Unexpected OAuth error.");
  }
});
