import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { backfillInvoiceFx } from "../_shared/invoiceFxBackfill.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await assertSuperAdminUser(req);

    const body = await req.json().catch(() => ({}));
    const admin = getServiceRoleSupabase();
    const fx = await backfillInvoiceFx(admin, {
      force: body.force === true,
      invoice_ids: Array.isArray(body.invoice_ids) ? body.invoice_ids : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });

    return json({
      ...fx,
      metrics_currency: "EUR",
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[backfill-invoice-fx]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
