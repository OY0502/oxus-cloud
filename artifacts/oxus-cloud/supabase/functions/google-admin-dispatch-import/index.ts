import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { queueGoogleImport } from "../_shared/googleSyncWorker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-admin-repair",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  const allowedSecrets = new Set<string>();
  if (serviceKey) allowedSecrets.add(serviceKey);
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw) as Record<string, string> | string[];
      if (Array.isArray(parsed)) {
        for (const value of parsed) if (typeof value === "string" && value) allowedSecrets.add(value);
      } else {
        for (const value of Object.values(parsed)) if (typeof value === "string" && value) allowedSecrets.add(value);
      }
    } catch {
      // ignore malformed secret-keys blob
    }
  }
  // Accept legacy JWT service_role tokens by role claim when secret match fails.
  let authorized = !!token && allowedSecrets.has(token);
  if (!authorized && token.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
      authorized = payload?.role === "service_role";
    } catch {
      authorized = false;
    }
  }
  if (!authorized) {
    return json({ error: "Service role required", code: "AUTH_REQUIRED" }, 401);
  }
  if (req.headers.get("X-Oxus-Admin-Repair") !== "google-reconnect-2026-07-15") {
    return json({ error: "Repair header required", code: "CONFIRM_REQUIRED" }, 400);
  }

  const body = await req.json() as {
    import_run_id?: string;
    connection_id?: string;
    user_id?: string;
    confirm?: boolean;
  };
  if (!body.confirm || !body.import_run_id || !body.connection_id || !body.user_id) {
    return json({ error: "confirm, import_run_id, connection_id, user_id required" }, 400);
  }

  const admin = getServiceRoleSupabase();
  const { data: run } = await admin
    .from("google_import_runs")
    .select("id, status, connection_id, owner_user_id, connection_generation, operation_identity, run_type, trigger_run_id, dispatch_status")
    .eq("id", body.import_run_id)
    .maybeSingle();

  if (!run || run.connection_id !== body.connection_id || run.owner_user_id !== body.user_id) {
    return json({ error: "Import run not found", code: "NOT_FOUND" }, 404);
  }
  if (run.trigger_run_id && run.dispatch_status === "dispatched") {
    return json({ ok: true, already_dispatched: true, trigger_run_id: run.trigger_run_id });
  }

  try {
    const queued = await queueGoogleImport(admin, run.id, body.connection_id, body.user_id, {
      connectionGeneration: run.connection_generation,
      operationIdentity: run.operation_identity,
      syncMode: run.run_type,
    });
    console.info("[google-admin-dispatch-import]", JSON.stringify({
      event: "admin_repair_dispatch",
      import_run_id: run.id,
      connection_id: body.connection_id,
      trigger_run_id: queued.trigger_run_id,
    }));
    return json({ ok: true, ...queued });
  } catch (e) {
    await admin.from("google_import_runs").update({
      status: "failed",
      progress_stage: "failed",
      error_code: "GOOGLE_SYNC_DISPATCH_FAILED",
      error: (e as Error).message?.slice(0, 300),
      dispatch_status: "dispatch_failed",
      failed_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return json({ ok: false, error: (e as Error).message, code: "GOOGLE_SYNC_DISPATCH_FAILED" }, 503);
  }
});
