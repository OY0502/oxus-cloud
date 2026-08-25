import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { runGoogleImportBatch, type GoogleSyncBatchAction } from "../_shared/googleSyncBatch.ts";
import {
  authenticateInternalWorker,
  internalWorkerAuthErrorResponse,
} from "../_shared/internalWorkerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_ACTIONS = new Set<GoogleSyncBatchAction>([
  "validate",
  "contacts_page",
  "calendar_page",
  "gmail_discover_page",
  "resolve_basic_entities",
  "resolve_entities",
  "complete_core_sync",
  "filter_enrichment_threads",
  "group_relationships",
  "enrich_relationship_batch",
  "gmail_process_batch",
  "reconcile_reset",
  "enrich_companies",
  "finalize",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function correlationId(req: Request, body?: { correlation_id?: string }): string {
  return (
    body?.correlation_id?.trim() ||
    req.headers.get("x-correlation-id")?.trim() ||
    crypto.randomUUID()
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: {
    import_run_id?: string;
    action?: string;
    mode?: string;
    correlation_id?: string;
    trigger_run_id?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body.", code: "INVALID_WORKER_PAYLOAD" }, 400);
  }

  const cid = correlationId(req, body);
  const auth = await authenticateInternalWorker(req);

  if (!auth.ok) {
    console.warn("[google-sync-worker] internal auth failed", {
      correlation_id: cid,
      code: auth.code,
    });
    return internalWorkerAuthErrorResponse(auth.code, cid, corsHeaders);
  }

  if (body.mode === "auth_smoke_test") {
    return json({
      ok: true,
      auth: auth.method,
      environment: Deno.env.get("GOOGLE_APP_URL")?.includes("oxus.cloud") ? "production" : "development",
      correlation_id: cid,
    });
  }

  if (!body.import_run_id?.trim()) {
    return json({
      error: "import_run_id required.",
      code: "INVALID_WORKER_PAYLOAD",
      correlation_id: cid,
    }, 400);
  }

  const action = (body.action ?? "validate") as GoogleSyncBatchAction;
  if (!VALID_ACTIONS.has(action)) {
    return json({
      error: `Invalid action: ${action}`,
      code: "INVALID_WORKER_PAYLOAD",
      correlation_id: cid,
    }, 400);
  }

  const started = Date.now();
  try {
    const admin = getServiceRoleSupabase();
    const result = await runGoogleImportBatch(admin, body.import_run_id.trim(), action, {
      correlationId: cid,
      triggerRunId: body.trigger_run_id ?? null,
    });
    console.info("[google-sync-worker] batch completed", {
      correlation_id: cid,
      import_run_id: body.import_run_id,
      action,
      done: result.done,
      duration_ms: Date.now() - started,
      processed_in_batch: result.processed_in_batch,
    });
    return json({ success: true, correlation_id: cid, ...result });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code ?? "SYNC_FAILED";
    console.error("[google-sync-worker] batch failed", {
      correlation_id: cid,
      import_run_id: body.import_run_id,
      action,
      code,
      duration_ms: Date.now() - started,
      message: err.message,
    });
    return json({
      error: err.message,
      code,
      correlation_id: cid,
      action,
    }, code.startsWith("GOOGLE_") ? 502 : 500);
  }
});
