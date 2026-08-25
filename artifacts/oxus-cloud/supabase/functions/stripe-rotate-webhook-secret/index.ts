import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  authenticateInternalWorker,
  internalWorkerAuthErrorResponse,
} from "../_shared/internalWorkerAuth.ts";
import {
  createStripeClient,
  getStripeWebhookSecret,
} from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
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
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const auth = await authenticateInternalWorker(req);
  if (!auth.ok) {
    return internalWorkerAuthErrorResponse(
      auth.code,
      crypto.randomUUID(),
      corsHeaders,
    );
  }

  try {
    const stripe = createStripeClient();
    if (!stripe) return json({ error: "Stripe not configured." }, 500);

    const body = (await req.json().catch(() => ({}))) as {
      action?: "prepare" | "verify" | "finalize";
      keep_endpoint_id?: string;
    };
    const action = body.action ?? "prepare";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const expectedUrl = supabaseUrl ? `${supabaseUrl}${WEBHOOK_SUFFIX}` : null;
    if (!expectedUrl)
      return json({ error: "SUPABASE_URL is not configured." }, 500);

    if (action === "verify") {
      const webhookSecret = getStripeWebhookSecret();
      if (!webhookSecret) {
        return json({ error: "Webhook secret is not configured." }, 500);
      }

      const eventId = `evt_oxus_webhook_health_${Date.now()}`;
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        api_version: null,
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: "oxus_webhook_healthcheck" } },
        livemode: true,
        pending_webhooks: 1,
        request: null,
        type: "oxus.webhook.healthcheck",
      });
      const signature = await stripe.webhooks.generateTestHeaderStringAsync({
        payload,
        secret: webhookSecret,
      });
      const response = await fetch(expectedUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": signature,
        },
        body: payload,
      });
      const responseText = await response.text();

      return json(
        {
          ok: response.ok,
          endpoint_url: expectedUrl,
          webhook_status: response.status,
          event_id: eventId,
          response: responseText.slice(0, 300),
        },
        response.ok ? 200 : 502,
      );
    }

    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const matches = (endpoints.data ?? []).filter(
      (endpoint) =>
        endpoint.url === expectedUrl || endpoint.url.endsWith(WEBHOOK_SUFFIX),
    );

    if (action === "finalize") {
      const keepEndpointId = body.keep_endpoint_id?.trim();
      const keepEndpoint = matches.find(
        (endpoint) => endpoint.id === keepEndpointId,
      );
      if (!keepEndpointId || !keepEndpoint) {
        return json(
          {
            error: "A valid keep_endpoint_id for the OXUS webhook is required.",
          },
          400,
        );
      }

      const removedEndpointIds: string[] = [];
      for (const endpoint of matches) {
        if (endpoint.id === keepEndpointId) continue;
        await stripe.webhookEndpoints.del(endpoint.id);
        removedEndpointIds.push(endpoint.id);
      }

      return json({
        ok: true,
        endpoint_id: keepEndpoint.id,
        endpoint_url: keepEndpoint.url,
        removed_endpoint_ids: removedEndpointIds,
      });
    }

    if (action !== "prepare")
      return json({ error: "Unsupported action." }, 400);

    // Create first and leave existing endpoints active. The caller installs the
    // new signing secret before making a separate finalize request.
    const created = await stripe.webhookEndpoints.create({
      url: expectedUrl,
      enabled_events: ENABLED_EVENTS,
      description: "OXUS Cloud Supabase stripe-webhook",
    });

    if (!created.secret) {
      return json(
        {
          error:
            "Stripe created the endpoint but did not return a signing secret.",
        },
        502,
      );
    }

    const admin = getServiceRoleSupabase();
    const { error: stateError } = await admin
      .from("stripe_integration_state")
      .update({
        webhook_endpoint_url: created.url,
        updated_at: new Date().toISOString(),
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (stateError) throw new Error(stateError.message);

    return json({
      ok: true,
      endpoint_id: created.id,
      endpoint_url: created.url,
      endpoint_status: created.status,
      webhook_secret: created.secret,
      previous_endpoint_ids: matches.map((endpoint) => endpoint.id),
      api_version: created.api_version ?? null,
      livemode: created.livemode ?? null,
    });
  } catch (e) {
    console.error("[stripe-rotate-webhook-secret]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
