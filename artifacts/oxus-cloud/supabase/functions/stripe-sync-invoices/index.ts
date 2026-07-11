import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { createStripeClient, isStripeConfigured } from "../_shared/stripe.ts";
import { syncStripeInvoices } from "../_shared/stripeInvoiceSync.ts";
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

    if (!isStripeConfigured()) {
      return json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY.", code: "NOT_CONFIGURED" }, 400);
    }

    const stripe = createStripeClient();
    if (!stripe) return json({ error: "Stripe client unavailable." }, 500);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const admin = getServiceRoleSupabase();
    const result = await syncStripeInvoices(admin, stripe, {
      force: body.force === true,
      created_after: typeof body.created_after === "string" ? body.created_after : undefined,
    });

    const invoicesSynced = result.imported + result.updated;
    const fx = await backfillInvoiceFx(admin, { force: false, all: true });

    return json({
      ...result,
      invoices_synced: invoicesSynced,
      ...fx,
      metrics_currency: "EUR",
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-sync-invoices]", (e as Error).message);

    const admin = getServiceRoleSupabase();
    await admin.from("stripe_integration_state").update({
      last_sync_error: (e as Error).message,
      updated_at: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    return json({ error: (e as Error).message }, 500);
  }
});
