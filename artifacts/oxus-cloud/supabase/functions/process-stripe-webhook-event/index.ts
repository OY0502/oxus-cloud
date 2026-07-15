import type Stripe from "npm:stripe@17.7.0";
import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { authenticateInternalWorker, internalWorkerAuthErrorResponse } from "../_shared/internalWorkerAuth.ts";
import { createStripeClient } from "../_shared/stripe.ts";
import {
  claimStripeWebhookInboxEvent,
  markStripeWebhookInboxFailed,
  markStripeWebhookInboxProcessed,
} from "../_shared/stripeWebhookInbox.ts";
import { processStripeWebhookEvent } from "../_shared/stripeWebhookProcessor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
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

  const auth = await authenticateInternalWorker(req);
  if (!auth.ok) {
    return internalWorkerAuthErrorResponse(auth.code, crypto.randomUUID(), corsHeaders);
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      inbox_id?: string;
      stripe_event_id?: string;
    };

    const admin = getServiceRoleSupabase();
    let inboxId = body.inbox_id?.trim();

    if (!inboxId && body.stripe_event_id?.trim()) {
      const { data } = await admin
        .from("stripe_webhook_events")
        .select("id")
        .eq("stripe_event_id", body.stripe_event_id.trim())
        .maybeSingle();
      inboxId = data?.id;
    }

    if (!inboxId) {
      return json({ error: "inbox_id or stripe_event_id is required." }, 400);
    }

    const row = await claimStripeWebhookInboxEvent(admin, inboxId);
    if (!row) return json({ error: "Webhook inbox event not found." }, 404);

    if (row.status === "processed" || row.status === "ignored") {
      return json({
        ok: true,
        duplicate: true,
        outcome: row.status,
        stripe_event_id: row.stripe_event_id,
      });
    }

    const payload = row.payload as Stripe.Event | null;
    if (!payload?.id) {
      await markStripeWebhookInboxFailed(admin, inboxId, "Missing event payload.");
      return json({ error: "Missing event payload." }, 422);
    }

    const stripe = createStripeClient();
    if (!stripe) {
      await markStripeWebhookInboxFailed(admin, inboxId, "Stripe client unavailable.");
      return json({ error: "Stripe client unavailable." }, 500);
    }

    try {
      const result = await processStripeWebhookEvent(admin, payload, stripe);
      await markStripeWebhookInboxProcessed(admin, inboxId, row.stripe_event_id, result.outcome);
      return json({ ok: true, ...result });
    } catch (processErr) {
      const message = processErr instanceof Error ? processErr.message : "Processing failed.";
      await markStripeWebhookInboxFailed(admin, inboxId, message);
      return json({ error: message }, 500);
    }
  } catch (e) {
    console.error("[process-stripe-webhook-event]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
