import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  executeStripeInvoiceAction,
  type StripeInvoiceAction,
  updateInvoiceProjectMapping,
} from "../_shared/stripeInvoiceActions.ts";

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

const ACTIONS = new Set<StripeInvoiceAction>([
  "finalize",
  "send",
  "mark_paid_out_of_band",
  "void",
  "mark_uncollectible",
  "delete_draft",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as {
      invoice_id?: string;
      action?: StripeInvoiceAction;
      project_id?: string | null;
    };

    if (!body.invoice_id) return json({ error: "invoice_id is required." }, 400);

    const admin = getServiceRoleSupabase();

    if (body.action === undefined && "project_id" in body) {
      const result = await updateInvoiceProjectMapping(admin, auth.userId, body.invoice_id, body.project_id ?? null);
      return json({ ok: true, ...result });
    }

    if (!body.action || !ACTIONS.has(body.action)) {
      return json({ error: "Invalid or missing action." }, 400);
    }

    const result = await executeStripeInvoiceAction(admin, auth.userId, body.invoice_id, body.action);
    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-invoice-action]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
