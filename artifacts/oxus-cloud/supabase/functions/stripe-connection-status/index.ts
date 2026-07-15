import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  createStripeClient,
  fetchSafeStripeAccountInfo,
  getStripeWebhookSecret,
  isStripeConfigured,
} from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const WEBHOOK_PATH = "/functions/v1/stripe-webhook";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function countEventsByStatus(admin: ReturnType<typeof getServiceRoleSupabase>, status: string): Promise<number> {
  const { count, error } = await admin
    .from("stripe_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw new Error(error.message);
  return count ?? 0;
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const endpointUrl = state?.webhook_endpoint_url
      ?? (supabaseUrl ? `${supabaseUrl}${WEBHOOK_PATH}` : null);

    let endpointReachable: boolean | null = null;
    if (endpointUrl) {
      try {
        const probe = await fetch(endpointUrl, { method: "POST", body: "{}" });
        endpointReachable = probe.status === 400 || probe.status === 200;
      } catch {
        endpointReachable = false;
      }
    }

    const webhookConfigured = !!getStripeWebhookSecret();
    const [pending, received, failed, processing, processed] = await Promise.all([
      countEventsByStatus(admin, "pending"),
      countEventsByStatus(admin, "received"),
      countEventsByStatus(admin, "failed"),
      countEventsByStatus(admin, "processing"),
      countEventsByStatus(admin, "processed"),
    ]);

    if (!configured) {
      return json({
        configured: false,
        connected: false,
        account: null,
        last_successful_sync_at: state?.last_successful_sync_at ?? null,
        last_sync_error: state?.last_sync_error ?? "STRIPE_SECRET_KEY is not configured.",
        webhook_configured: webhookConfigured,
        webhook_last_received_at: state?.webhook_last_received_at ?? null,
        webhook_last_processed_at: state?.webhook_last_processed_at ?? null,
        webhook_last_event_id: state?.webhook_last_event_id ?? null,
        webhook_endpoint_url: endpointUrl,
        webhook_endpoint_reachable: endpointReachable,
        webhook_pending_events: pending + received,
        webhook_failed_events: failed,
        webhook_processing_events: processing,
        webhook_processed_events: processed,
      });
    }

    const account = await fetchSafeStripeAccountInfo();

    await admin.from("stripe_integration_state").update({
      configured: true,
      account_id: account.account_id,
      business_name: account.business_name,
      webhook_endpoint_url: endpointUrl,
      updated_at: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

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
      webhook_last_processed_at: state?.webhook_last_processed_at ?? null,
      webhook_last_event_id: state?.webhook_last_event_id ?? null,
      webhook_endpoint_url: endpointUrl,
      webhook_endpoint_reachable: endpointReachable,
      webhook_pending_events: pending + received,
      webhook_failed_events: failed,
      webhook_processing_events: processing,
      webhook_processed_events: processed,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-connection-status]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
