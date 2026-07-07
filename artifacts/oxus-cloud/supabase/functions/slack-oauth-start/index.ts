import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getAuthenticatedUser, requireSuperAdmin } from "../_shared/slack-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "users:read",
  "users:read.email",
  "app_mentions:read",
].join(",");

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

function randomState(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
    if (!auth) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const isAdmin = await requireSuperAdmin(auth.userId);
    if (!isAdmin) return err("Only super admins can connect the Slack workspace.", 403, "FORBIDDEN");

    const clientId = Deno.env.get("SLACK_CLIENT_ID")?.trim();
    const redirectUri = Deno.env.get("SLACK_OAUTH_REDIRECT_URI")?.trim();
    if (!clientId || !redirectUri) {
      return err(
        "Slack OAuth is not configured on the server.",
        500,
        "CONFIG_ERROR",
        "Missing SLACK_CLIENT_ID or SLACK_OAUTH_REDIRECT_URI.",
      );
    }

    let body: { redirect_after?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty ok
    }

    const state = randomState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const redirectAfter =
      typeof body.redirect_after === "string" && body.redirect_after.trim()
        ? body.redirect_after.trim()
        : "/settings";

    const admin = getServiceRoleSupabase();
    const { error: insertErr } = await admin.from("slack_oauth_states").insert({
      state,
      user_id: auth.userId,
      redirect_after: redirectAfter,
      expires_at: expiresAt,
      status: "pending",
    });
    if (insertErr) return err("Failed to start Slack OAuth.", 500, "DB_ERROR", insertErr.message);

    const authUrl =
      `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    return json({ auth_url: authUrl });
  } catch (e) {
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
