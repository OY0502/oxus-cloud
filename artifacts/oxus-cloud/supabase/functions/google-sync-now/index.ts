import { createClient } from "npm:@supabase/supabase-js@2";

import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { acquireGoogleSyncRun, canonicalStageFromRun } from "../_shared/googleImportLock.ts";
import { shouldQueueTriggerDevTasks, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { assertInternalOxusAuthUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";



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



function syncResponse(importRun: {

  id: string;

  status: string;

  progress_stage: string | null;

  trigger_run_id: string | null;

}, alreadyRunning: boolean, extra?: Record<string, unknown>) {

  return json({

    accepted: true,

    already_running: alreadyRunning,

    import_run_id: importRun.id,

    trigger_run_id: importRun.trigger_run_id ?? undefined,

    status: canonicalStageFromRun(importRun),

    queued: !alreadyRunning,

    ...extra,

  });

}



Deno.serve(async (req) => {

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");



  try {

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");



    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();

    const anonKey = getAnonKey();

    const supabase = createClient(supabaseUrl!, anonKey!, {

      global: { headers: { Authorization: authHeader } },

      auth: { persistSession: false },

    });



    const token = authHeader.replace("Bearer ", "");

    const { data: auth } = await supabase.auth.getUser(token);

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

    let body: { sources?: string[]; calendar_only?: boolean; retry?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // empty body ok
    }

    const enabled = connection.sources_enabled as Record<string, boolean>;

    const sources = body.sources?.length
      ? body.sources.filter((s) => {
          if (s === "contacts") return enabled.contacts !== false;
          if (s === "calendar") return enabled.calendar !== false;
          if (s === "gmail") return enabled.gmail;
          return false;
        })
      : body.calendar_only
        ? (enabled.calendar !== false ? ["calendar"] : [])
        : [
            ...(enabled.contacts !== false ? ["contacts"] : []),
            ...(enabled.calendar !== false ? ["calendar"] : []),
            ...(enabled.gmail ? ["gmail"] : []),
          ];

    if (sources.length === 0) {
      return err("No Google sources enabled for sync.", 400, "GOOGLE_NO_SOURCES_ENABLED");
    }



    const importSettings = (connection.import_settings as Record<string, unknown>) ?? {};
    const connectionGeneration = Number((connection as { connection_generation?: number }).connection_generation ?? 1);
    const { buildGoogleOperationIdentity } = await import("../_shared/googleImportLock.ts");
    const operationIdentity = buildGoogleOperationIdentity({
      connectionId: connection.id,
      googleAccountId: String((connection as { google_account_id?: string }).google_account_id ?? "unknown"),
      connectionGeneration,
      syncMode: body.retry ? "recovery" : "incremental",
      recoveryGeneration: body.retry ? Date.now() : Date.now(),
    });

    const acquired = await acquireGoogleSyncRun(admin, {

      connection_id: connection.id,

      owner_user_id: userId,

      run_type: body.retry ? "recovery" : "incremental",

      sources,

      lookback_months: (importSettings.lookback_months as number | undefined) ?? 12,

      settings: importSettings,

      connection_generation: connectionGeneration,

      operation_identity: operationIdentity,

      sync_mode: body.retry ? "recovery" : "incremental",

    }, { resume: body.retry === true });



    const importRun = acquired.import_run;

    if (acquired.already_running) {

      return syncResponse(importRun, true);

    }



    if (shouldQueueTriggerDevTasks()) {
      const taskId = importRun.run_type === "initial" || importRun.run_type === "recovery"
        ? "google-initial-import"
        : "google-incremental-sync";
      try {
        const result = await triggerDevTask(taskId, {
          import_run_id: importRun.id,
          connection_id: connection.id,
          user_id: userId,
          correlation_id: importRun.correlation_id ?? crypto.randomUUID(),
          connection_generation: connectionGeneration,
        }, { idempotencyKey: operationIdentity });
        const { data: updated } = await admin
          .from("google_import_runs")
          .update({
            trigger_run_id: result.id,
            status: "starting",
            progress_stage: "queued",
            dispatch_status: "dispatched",
            last_heartbeat_at: new Date().toISOString(),
          })
          .eq("id", importRun.id)
          .select("id, status, progress_stage, trigger_run_id")
          .single();
        return syncResponse(updated ?? { ...importRun, status: "starting", progress_stage: "queued", trigger_run_id: result.id }, false, {
          trigger_run_id: result.id,
        });
      } catch (dispatchError) {
        await admin.from("google_import_runs").update({
          status: "failed",
          progress_stage: "failed",
          error_code: "GOOGLE_SYNC_DISPATCH_FAILED",
          error: (dispatchError as Error).message?.slice(0, 300) ?? "Failed to dispatch Google sync.",
          dispatch_status: "dispatch_failed",
          failed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }).eq("id", importRun.id);
        return err(
          "Could not start Google sync. Please try again.",
          503,
          "GOOGLE_SYNC_DISPATCH_FAILED",
          (dispatchError as Error).message,
        );
      }
    }

    await admin.from("google_import_runs").update({
      status: "failed",
      progress_stage: "failed",
      error_code: "TRIGGER_NOT_CONFIGURED",
      error: "Background sync is not configured.",
      dispatch_status: "dispatch_failed",
      failed_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq("id", importRun.id);

    return err(
      "Background sync is not configured. Set TRIGGER_SECRET_KEY for production.",
      503,
      "TRIGGER_NOT_CONFIGURED",
    );

  } catch (e) {

    console.error("[google-sync-now]", (e as Error).message);

    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);

  }

});
