import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { getAuthenticatedUser, requireSuperAdmin } from "../_shared/slack-auth.ts";

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

    const isAdmin = await requireSuperAdmin(auth.userId);
    if (!isAdmin) return err("Only super admins can disconnect Slack.", 403, "FORBIDDEN");

    const admin = getServiceRoleSupabase();
    const { error } = await admin
      .from("slack_workspaces")
      .update({
        status: "revoked",
        bot_access_token_encrypted: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("status", "active");

    if (error) return err("Failed to disconnect Slack.", 500, "DB_ERROR", error.message);
    return json({ disconnected: true });
  } catch (e) {
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
