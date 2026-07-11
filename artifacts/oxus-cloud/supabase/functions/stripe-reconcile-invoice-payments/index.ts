import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { createStripeClient, isStripeConfigured } from "../_shared/stripe.ts";
import {
  aggregateReconciliationMonth,
  reconcileStripeInvoicePayments,
} from "../_shared/stripePaymentReconcile.ts";

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

    if (!isStripeConfigured()) {
      return json({ error: "Stripe is not configured.", code: "NOT_CONFIGURED" }, 400);
    }

    const stripe = createStripeClient();
    if (!stripe) return json({ error: "Stripe client unavailable." }, 500);

    const body = await req.json().catch(() => ({}));
    const admin = getServiceRoleSupabase();

    const reconcile = await reconcileStripeInvoicePayments(admin, stripe, {
      invoice_id: typeof body.invoice_id === "string" ? body.invoice_id : undefined,
      month: typeof body.month === "string" ? body.month : undefined,
      force: body.force === true,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });

    const monthSummary = await aggregateReconciliationMonth(
      admin,
      typeof body.month === "string" ? body.month : undefined,
    );

    return json({
      ...reconcile,
      month_summary: monthSummary,
      metrics_currency: "EUR",
      reporting_timezone: "Europe/Lisbon",
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-reconcile-invoice-payments]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
