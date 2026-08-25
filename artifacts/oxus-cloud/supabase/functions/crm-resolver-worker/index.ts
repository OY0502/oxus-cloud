import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { runResolverStage, runFullAccountMigration, buildCalendarAuditReport } from "../_shared/crmIdentity/pipeline.ts";
import { authenticateInternalWorker, internalWorkerAuthErrorResponse } from "../_shared/internalWorkerAuth.ts";
import { assertSuperAdminUser, internalOxusAuthErrorResponse, InternalOxusAuthError } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const worker = await authenticateInternalWorker(req);
    if (!worker.ok) {
      try {
        await assertSuperAdminUser(req);
      } catch (e) {
        if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
        return internalWorkerAuthErrorResponse(worker.code ?? "INTERNAL_AUTH_INVALID", "crm-resolver-worker", corsHeaders);
      }
    }

    const body = await req.json() as {
      action?: "run_stage" | "migrate_account";
      run_id?: string;
      connection_id?: string;
    };
    const admin = getServiceRoleSupabase();

    if (body.action === "migrate_account") {
      if (!body.connection_id) return json({ error: "connection_id required" }, 400);
      const result = await runFullAccountMigration(admin, body.connection_id);
      return json({ ok: true, ...result });
    }

    if (body.action === "calendar_audit") {
      if (!body.connection_id) return json({ error: "connection_id required" }, 400);
      const audit = await buildCalendarAuditReport(admin, body.connection_id);
      return json({ ok: true, audit });
    }

    if (!body.run_id) return json({ error: "run_id required for run_stage" }, 400);
    const result = await runResolverStage(admin, body.run_id);
    return json({ ok: true, ...result });
  } catch (e) {
    console.error("[crm-resolver-worker]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
