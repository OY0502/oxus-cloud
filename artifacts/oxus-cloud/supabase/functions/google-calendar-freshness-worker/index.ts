import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import {
  authenticateInternalWorker,
  internalWorkerAuthErrorResponse,
} from "../_shared/internalWorkerAuth.ts";
import { runCalendarFreshnessSync } from "../_shared/googleCalendarFreshnessSync.ts";
import { calendarLeaseKey } from "../_shared/googleSyncLease.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }, 405);

  const auth = await authenticateInternalWorker(req);
  if (!auth.ok) return internalWorkerAuthErrorResponse(auth.code, crypto.randomUUID(), corsHeaders);

  let body: {
    connection_id?: string;
    user_id?: string;
    lease_key?: string;
    trigger_run_id?: string;
    sync_reason?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body.", code: "INVALID_WORKER_PAYLOAD" }, 400);
  }

  if (!body.connection_id?.trim() || !body.user_id?.trim()) {
    return json({ error: "connection_id and user_id required.", code: "INVALID_WORKER_PAYLOAD" }, 400);
  }

  const started = Date.now();
  try {
    const admin = getServiceRoleSupabase();
    const { data: connection } = await admin
      .from("user_google_connections")
      .select("*")
      .eq("id", body.connection_id.trim())
      .eq("user_id", body.user_id.trim())
      .maybeSingle();

    if (!connection || connection.status !== "active") {
      return json({ error: "Google connection not active.", code: "GOOGLE_NOT_CONNECTED" }, 400);
    }

    const counters = await runCalendarFreshnessSync(admin, connection, {
      lease_key: body.lease_key ?? calendarLeaseKey(connection.id),
      trigger_run_id: body.trigger_run_id,
    });

    console.info("[google-calendar-freshness-worker] completed", {
      connection_id: connection.id,
      sync_reason: body.sync_reason ?? "background",
      duration_ms: Date.now() - started,
      counters,
    });

    return json({ success: true, counters, sync_reason: body.sync_reason ?? "background" });
  } catch (e) {
    console.error("[google-calendar-freshness-worker] failed", (e as Error).message);
    return json({ error: (e as Error).message, code: "CALENDAR_FRESHNESS_FAILED" }, 500);
  }
});
