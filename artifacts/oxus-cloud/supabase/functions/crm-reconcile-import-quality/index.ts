import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { reconcileCrmImportQuality } from "../_shared/crmImportQualityReconcile.ts";
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

async function authorizeReconcile(req: Request): Promise<{ userId?: string }> {
  const worker = await authenticateInternalWorker(req);
  if (worker.ok) return {};
  try {
    const auth = await assertSuperAdminUser(req);
    return { userId: auth.userId };
  } catch (e) {
    if (e instanceof InternalOxusAuthError) throw e;
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const auth = await authorizeReconcile(req);
    const body = await req.json() as { dry_run?: boolean; run_key?: string };
    const admin = getServiceRoleSupabase();
    const report = await reconcileCrmImportQuality(admin, {
      dryRun: body.dry_run ?? false,
      userId: auth.userId,
      runKey: body.run_key,
    });
    return json({ ok: true, report });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    const workerCode = (e as { code?: string })?.code;
    if (workerCode === "INTERNAL_AUTH_MISSING" || workerCode === "INTERNAL_AUTH_INVALID") {
      return internalWorkerAuthErrorResponse(workerCode, "crm-reconcile", corsHeaders);
    }
    console.error("[crm-reconcile-import-quality]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
