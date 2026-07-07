import { getClickupBaseUrl, getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { encryptClickupToken, hasClickupTokenEncryptionKey } from "../_shared/clickupTokenCrypto.ts";

function appUrl(): string {
  return (Deno.env.get("CLICKUP_APP_URL") ?? "http://localhost:5173").replace(/\/+$/, "");
}

function buildAppUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Primary redirect — browsers follow this reliably after ClickUp OAuth. */
function redirectTo(path: string): Response {
  const location = buildAppUrl(path);
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
    },
  });
}

/** HTML fallback with properly escaped URLs (unescaped & breaks meta refresh). */
function redirectHtml(path: string, title: string): Response {
  const location = buildAppUrl(path);
  const safeLocation = escapeHtml(location);
  const safeTitle = escapeHtml(title);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${safeLocation}">
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #111; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>If you are not redirected automatically, <a href="${safeLocation}">continue to OXUS Cloud</a>.</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function redirectError(message: string, redirectAfter?: string | null): Response {
  const path = appendClickupQuery(redirectAfter?.trim() || "/settings", "error", message);
  return redirectTo(path);
}

function redirectSuccess(redirectAfter?: string | null): Response {
  const path = appendClickupQuery(redirectAfter?.trim() || "/settings", "connected");
  return redirectTo(path);
}

function appendClickupQuery(
  path: string,
  status: "connected" | "error",
  message?: string,
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, appUrl());
  url.searchParams.set("clickup", status);
  if (status === "error" && message) {
    url.searchParams.set("message", message.slice(0, 500));
  }
  return `${url.pathname}${url.search}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const clientId = Deno.env.get("CLICKUP_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("CLICKUP_OAUTH_CLIENT_SECRET")?.trim();
  const redirectUri = Deno.env.get("CLICKUP_OAUTH_REDIRECT_URI")?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("ClickUp OAuth is not configured on the server.");
  }

  const resp = await fetch(`${getClickupBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`ClickUp token exchange failed: ${text.slice(0, 400)}`);
  }
  const payload = JSON.parse(text) as { access_token?: string };
  if (!payload.access_token) throw new Error("ClickUp token exchange returned no access token.");
  return payload.access_token;
}

async function clickupGet(accessToken: string, path: string): Promise<any> {
  const resp = await fetch(`${getClickupBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`ClickUp API ${path} failed: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function normalizeTeams(payload: any): Array<{ id: string; name: string; color?: string | null }> {
  const teams = payload?.teams ?? [];
  if (!Array.isArray(teams)) return [];
  return teams
    .map((team: any) => {
      const id = team?.id ?? team?.team_id;
      if (id === undefined || id === null) return null;
      return {
        id: String(id),
        name: team?.name ?? String(id),
        color: team?.color ?? null,
      };
    })
    .filter((team): team is { id: string; name: string; color?: string | null } => team !== null);
}

async function hasActiveConnection(admin: ReturnType<typeof getServiceRoleSupabase>, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_clickup_connections")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.status === "active";
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) return redirectError("Missing OAuth code or state.");

    if (!hasClickupTokenEncryptionKey()) {
      return redirectError("ClickUp token encryption is not configured on the server.");
    }

    const admin = getServiceRoleSupabase();
    const { data: oauthState, error: stateErr } = await admin
      .from("clickup_oauth_states")
      .select("*")
      .eq("state", state)
      .maybeSingle();
    if (stateErr || !oauthState) return redirectError("Invalid OAuth state.");

    if (oauthState.status !== "pending") {
      if (await hasActiveConnection(admin, oauthState.user_id)) {
        return redirectSuccess(oauthState.redirect_after as string | null);
      }
      return redirectError(
        "OAuth session was already used. Please connect ClickUp again from Settings.",
        oauthState.redirect_after as string | null,
      );
    }

    if (new Date(oauthState.expires_at).getTime() < Date.now()) {
      await admin.from("clickup_oauth_states").update({ status: "expired" }).eq("id", oauthState.id);
      return redirectError("OAuth session expired. Please try again.", oauthState.redirect_after as string | null);
    }

    let accessToken: string;
    try {
      accessToken = await exchangeCodeForToken(code);
    } catch (e) {
      await admin.from("clickup_oauth_states").update({ status: "failed", used_at: new Date().toISOString() }).eq("id", oauthState.id);
      return redirectError((e as Error).message, oauthState.redirect_after as string | null);
    }

    let teams: Array<{ id: string; name: string; color?: string | null }> = [];
    let clickupUserId: string | null = null;
    let clickupUsername: string | null = null;
    let clickupEmail: string | null = null;

    try {
      const teamsResp = await clickupGet(accessToken, "/team");
      teams = normalizeTeams(teamsResp);
      try {
        const userResp = await clickupGet(accessToken, "/user");
        const user = userResp?.user ?? userResp;
        clickupUserId = user?.id !== undefined ? String(user.id) : null;
        clickupUsername = user?.username ?? user?.name ?? null;
        clickupEmail = user?.email ?? null;
      } catch {
        // user endpoint optional
      }
    } catch (e) {
      await admin.from("clickup_oauth_states").update({ status: "failed", used_at: new Date().toISOString() }).eq("id", oauthState.id);
      return redirectError((e as Error).message, oauthState.redirect_after as string | null);
    }

    if (teams.length === 0) {
      return redirectError("No authorized ClickUp workspaces were returned.", oauthState.redirect_after as string | null);
    }

    const envTeamId = Deno.env.get("CLICKUP_TEAM_ID")?.trim();
    const selected = (envTeamId && teams.some((team) => team.id === envTeamId)
      ? teams.find((team) => team.id === envTeamId)
      : teams[0])!;

    const encryptedToken = await encryptClickupToken(accessToken);
    const now = new Date().toISOString();

    const { error: upsertErr } = await admin.from("user_clickup_connections").upsert(
      {
        user_id: oauthState.user_id,
        clickup_user_id: clickupUserId,
        clickup_username: clickupUsername,
        clickup_email: clickupEmail,
        access_token_encrypted: encryptedToken,
        authorized_teams: teams,
        selected_team_id: selected.id,
        selected_team_name: selected.name,
        status: "active",
        connected_at: now,
        last_verified_at: now,
        last_error: null,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
    if (upsertErr) {
      await admin.from("clickup_oauth_states").update({ status: "failed", used_at: now }).eq("id", oauthState.id);
      return redirectError(`Failed to save ClickUp connection: ${upsertErr.message}`, oauthState.redirect_after as string | null);
    }

    await admin.from("clickup_oauth_states").update({ status: "used", used_at: now }).eq("id", oauthState.id);
    return redirectSuccess(oauthState.redirect_after as string | null);
  } catch (e) {
    console.error("[clickup-oauth-callback]", (e as Error).message, (e as Error).stack);
    return redirectError((e as Error).message || "Unexpected OAuth error.");
  }
});
