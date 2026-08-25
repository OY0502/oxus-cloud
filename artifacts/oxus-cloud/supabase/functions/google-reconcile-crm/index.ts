import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { acquireGoogleSyncRun } from "../_shared/googleImportLock.ts";
import { shouldQueueTriggerDevTasks, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
}

function getAnonKey(): string | null {
  const key = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (key) return key;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getAnonKey()!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: auth } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const admin = getServiceRoleSupabase();
    const { data: connection } = await admin.from("user_google_connections").select("*").eq("user_id", userId).maybeSingle();
    if (!connection || connection.status !== "active") {
      return err("Google is not connected.", 400, "GOOGLE_NOT_CONNECTED");
    }

    const importSettings = (connection.import_settings as Record<string, unknown>) ?? {};
    const acquired = await acquireGoogleSyncRun(admin, {
      connection_id: connection.id,
      owner_user_id: userId,
      run_type: "incremental",
      sources: ["contacts", "calendar"],
      lookback_months: (importSettings.lookback_months as number | undefined) ?? 12,
      settings: { ...importSettings, reconcile: true },
    });

    if (acquired.already_running) {
      return json({
        accepted: true,
        already_running: true,
        import_run_id: acquired.import_run.id,
        status: acquired.import_run.status,
      });
    }

    if (!shouldQueueTriggerDevTasks()) {
      return err("Background reconciliation requires Trigger.dev.", 503, "TRIGGER_NOT_CONFIGURED");
    }

    const result = await triggerDevTask("reconcile-google-crm-import", {
      import_run_id: acquired.import_run.id,
      connection_id: connection.id,
      user_id: userId,
      correlation_id: acquired.import_run.correlation_id ?? crypto.randomUUID(),
    }, { idempotencyKey: `reconcile:${connection.id}:${acquired.import_run.id}` });

    await admin.from("google_import_runs").update({ trigger_run_id: result.id }).eq("id", acquired.import_run.id);

    return json({
      accepted: true,
      already_running: false,
      import_run_id: acquired.import_run.id,
      trigger_run_id: result.id,
      queued: true,
    });
  } catch (e) {
    return err((e as Error).message, 500, "UNEXPECTED_ERROR");
  }
});
