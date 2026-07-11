import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  createStripeClient,
  fetchSafeStripeAccountInfo,
  isStripeConfigured,
} from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await assertSuperAdminUser(req);

    const configured = isStripeConfigured();
    const admin = getServiceRoleSupabase();

    const { data: state } = await admin
      .from("stripe_integration_state")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!configured) {
      return json({
        configured: false,
        connected: false,
        account: null,
        last_successful_sync_at: state?.last_successful_sync_at ?? null,
        last_sync_error: state?.last_sync_error ?? "STRIPE_SECRET_KEY is not configured.",
        webhook_last_received_at: state?.webhook_last_received_at ?? null,
      });
    }

    const account = await fetchSafeStripeAccountInfo();

    await admin.from("stripe_integration_state").update({
      configured: true,
      account_id: account.account_id,
      business_name: account.business_name,
      updated_at: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    const webhookConfigured = !!Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim();

    return json({
      configured: true,
      connected: account.configured,
      account: {
        id: account.account_id,
        business_name: account.business_name,
        country: account.country,
        default_currency: account.default_currency,
        email: account.email,
      },
      last_successful_sync_at: state?.last_successful_sync_at ?? null,
      last_sync_error: state?.last_sync_error ?? null,
      webhook_configured: webhookConfigured,
      webhook_last_received_at: state?.webhook_last_received_at ?? null,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-connection-status]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
