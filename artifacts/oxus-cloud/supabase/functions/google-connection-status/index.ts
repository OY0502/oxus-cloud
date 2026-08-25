import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { assertInternalOxusAuthUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  if (req.method !== "GET" && req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    if (!supabaseUrl || !anonKey) return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    const supabase = createClient(supabaseUrl, anonKey, {
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
    const { data: connection } = await admin
      .from("user_google_connections_safe")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!connection || connection.status === "revoked") {
      return json({ connected: false, connection: null, canonical_status: null });
    }

    const { findActiveGoogleImportRun } = await import("../_shared/googleImportLock.ts");
    const { loadCanonicalGoogleImportStatus } = await import("../_shared/googleImportStatus.ts");

    const activeImport = await findActiveGoogleImportRun(admin, connection.id);

    const { data: latestImport } = await admin
      .from("google_import_runs")
      .select("id, status, progress_stage, counts, started_at, completed_at, error, error_code, trigger_run_id, progress_processed, progress_total, progress_percentage, warnings, updated_at, run_type, sync_mode, lookback_months, source_progress, last_heartbeat_at, failed_at, core_sync_status, enrichment_status, enrichment_paused_at, processor_version, cost_metrics, recovered_at, resumed_at, resumed_from_trigger_run_id, last_historical_error_code, last_historical_error_message, import_history, connection_id, owner_user_id, created_at")
      .eq("connection_id", connection.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const trackingRun = activeImport ?? latestImport ?? null;
    const canonicalStatus = await loadCanonicalGoogleImportStatus(admin, {
      connectionId: connection.id,
      ownerUserId: userId,
      run: trackingRun,
      connectionError: connection.last_sync_error,
    });

    return json({
      connected: connection.status === "active",
      connection,
      latest_import: latestImport ?? null,
      active_import: activeImport ?? (canonicalStatus.active ? trackingRun : null),
      sync_stage: canonicalStatus.stage,
      canonical_status: canonicalStatus,
      gmail_scope_granted: (connection.granted_scopes ?? []).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ),
    });
  } catch (e) {
    console.error("[google-connection-status]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
