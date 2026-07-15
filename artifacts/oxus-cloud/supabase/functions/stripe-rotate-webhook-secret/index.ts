import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { authenticateInternalWorker, internalWorkerAuthErrorResponse } from "../_shared/internalWorkerAuth.ts";
import { createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEBHOOK_SUFFIX = "/functions/v1/stripe-webhook";

const ENABLED_EVENTS = [
  "invoice.created",
  "invoice.updated",
  "invoice.finalized",
  "invoice.sent",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice.deleted",
  "customer.created",
  "customer.updated",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const auth = await authenticateInternalWorker(req);
  if (!auth.ok) {
    return internalWorkerAuthErrorResponse(auth.code, crypto.randomUUID(), corsHeaders);
  }

  try {
    const stripe = createStripeClient();
    if (!stripe) return json({ error: "Stripe not configured." }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const expectedUrl = supabaseUrl ? `${supabaseUrl}${WEBHOOK_SUFFIX}` : null;
    if (!expectedUrl) return json({ error: "SUPABASE_URL is not configured." }, 500);

    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const matches = (endpoints.data ?? []).filter((endpoint) =>
      endpoint.url === expectedUrl || endpoint.url.endsWith(WEBHOOK_SUFFIX)
    );

    const replacedEndpointIds: string[] = [];
    for (const endpoint of matches) {
      await stripe.webhookEndpoints.del(endpoint.id);
      replacedEndpointIds.push(endpoint.id);
    }

    const created = await stripe.webhookEndpoints.create({
      url: expectedUrl,
      enabled_events: ENABLED_EVENTS,
      description: "OXUS Cloud Supabase stripe-webhook",
    });

    if (!created.secret) {
      return json({ error: "Stripe created the endpoint but did not return a signing secret." }, 502);
    }

    const admin = getServiceRoleSupabase();
    await admin.from("stripe_integration_state").update({
      webhook_endpoint_url: created.url,
      updated_at: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    return json({
      ok: true,
      endpoint_id: created.id,
      endpoint_url: created.url,
      endpoint_status: created.status,
      webhook_secret: created.secret,
      replaced_endpoint_ids: replacedEndpointIds,
      api_version: created.api_version ?? null,
      livemode: created.livemode ?? null,
    });
  } catch (e) {
    console.error("[stripe-rotate-webhook-secret]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
