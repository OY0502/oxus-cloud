import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { assertInternalOxusAuthUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function err(message: string, status: number, code: string) {
  return json({ error: message, code }, status);
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

    const body = await req.json() as {
      sources_enabled?: Record<string, boolean>;
      import_settings?: Record<string, unknown>;
      selected_calendars?: Array<{ id: string; enabled?: boolean; summary?: string; primary?: boolean; access_role?: string }>;
      trigger_calendar_sync?: boolean;
    };

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
    const { data: existing } = await admin
      .from("user_google_connections")
      .select("import_settings, sources_enabled")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!existing) return err("Google is not connected.", 400, "GOOGLE_NOT_CONNECTED");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.sources_enabled) patch.sources_enabled = body.sources_enabled;

    const mergedSettings = {
      ...(existing.import_settings as Record<string, unknown> ?? {}),
      ...(body.import_settings ?? {}),
    };
    if (body.selected_calendars) {
      mergedSettings.selected_calendars = body.selected_calendars;
    }
    patch.import_settings = mergedSettings;

    const { data, error } = await admin
      .from("user_google_connections")
      .update(patch)
      .eq("user_id", userId)
      .eq("status", "active")
      .select("id, sources_enabled, import_settings")
      .maybeSingle();

    if (error) return err(error.message, 500, "DB_ERROR");
    if (!data) return err("Google is not connected.", 400, "GOOGLE_NOT_CONNECTED");

    if (body.trigger_calendar_sync !== false && body.selected_calendars) {
      const { acquireGoogleSyncRun } = await import("../_shared/googleImportLock.ts");
      const { shouldQueueTriggerDevTasks, triggerDevTask } = await import("../_shared/agent/triggerDev.ts");
      const acquired = await acquireGoogleSyncRun(admin, {
        connection_id: data.id,
        owner_user_id: userId,
        run_type: "incremental",
        sources: ["calendar"],
        lookback_months: Number(mergedSettings.lookback_months ?? 12) || 12,
        settings: mergedSettings,
      });
      if (!acquired.already_running && shouldQueueTriggerDevTasks()) {
        await triggerDevTask("google-incremental-sync", {
          import_run_id: acquired.import_run.id,
          connection_id: data.id,
          user_id: userId,
          correlation_id: acquired.import_run.correlation_id ?? crypto.randomUUID(),
        }, { idempotencyKey: `google-cal-sync:${data.id}:${acquired.import_run.id}` });
      }
    }

    return json({ success: true, connection: data });
  } catch (e) {
    return err((e as Error).message, 500, "UNEXPECTED_ERROR");
  }
});
