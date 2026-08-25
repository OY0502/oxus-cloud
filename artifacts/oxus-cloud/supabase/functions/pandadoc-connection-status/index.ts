import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  getPandaDocWebhookSharedKey,
  isPandaDocConfigured,
  testPandaDocConnection,
  PandaDocError,
} from "../_shared/pandadoc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await assertSuperAdminUser(req);
    const admin = getServiceRoleSupabase();
    const configured = isPandaDocConfigured();
    const webhookConfigured = !!getPandaDocWebhookSharedKey();

    const { data: state } = await admin
      .from("pandadoc_integration_state")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!configured) {
      return json({
        configured: false,
        connected: false,
        workspace_name: null,
        last_successful_sync_at: state?.last_successful_sync_at ?? null,
        last_sync_error: state?.last_sync_error ?? "PANDADOC_API_KEY is not configured.",
        webhook_configured: webhookConfigured,
        webhook_last_received_at: state?.webhook_last_received_at ?? null,
      });
    }

    let testError: string | null = null;
    let workspaceName = state?.workspace_name ?? "PandaDoc workspace";
    let connected = false;

    try {
      const result = await testPandaDocConnection();
      connected = result.ok;
      workspaceName = result.workspace_name ?? workspaceName;
      await admin
        .from("pandadoc_integration_state")
        .update({
          configured: true,
          workspace_name: workspaceName,
          last_successful_sync_at: new Date().toISOString(),
          last_sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (e) {
      testError = e instanceof PandaDocError ? e.message : (e as Error).message;
      await admin
        .from("pandadoc_integration_state")
        .update({
          configured: true,
          last_sync_error: testError,
          updated_at: new Date().toISOString(),
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const { data: refreshed } = await admin
      .from("pandadoc_integration_state")
      .select("*")
      .limit(1)
      .maybeSingle();

    return json({
      configured: true,
      connected,
      workspace_name: workspaceName,
      last_successful_sync_at: refreshed?.last_successful_sync_at ?? null,
      last_sync_error: testError ?? refreshed?.last_sync_error ?? null,
      webhook_configured: webhookConfigured,
      webhook_last_received_at: refreshed?.webhook_last_received_at ?? null,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[pandadoc-connection-status]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
