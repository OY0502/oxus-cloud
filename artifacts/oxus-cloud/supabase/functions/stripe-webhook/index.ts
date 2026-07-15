import Stripe from "npm:stripe@17.7.0";
import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { createStripeClient, getStripeWebhookSecrets } from "../_shared/stripe.ts";
import {
  insertStripeWebhookInboxEvent,
  touchStripeWebhookReceived,
} from "../_shared/stripeWebhookInbox.ts";

const PROCESS_WEBHOOK_PATH = "/functions/v1/process-stripe-webhook-event";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function dispatchStripeWebhookProcessing(inboxId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("[stripe-webhook] missing env for async dispatch");
    return;
  }

  const workerSecret = Deno.env.get("GOOGLE_SYNC_WORKER_SECRET")?.trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  if (workerSecret) headers["x-oxus-internal-secret"] = workerSecret;

  const response = await fetch(`${supabaseUrl}${PROCESS_WEBHOOK_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ inbox_id: inboxId }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[stripe-webhook] async dispatch failed", response.status, text.slice(0, 300));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const rawBody = await req.text();

  try {
    const webhookSecrets = getStripeWebhookSecrets();
    if (!webhookSecrets.length) {
      return json({ error: "Webhook secret not configured." }, 500);
    }

    const stripe = createStripeClient();
    if (!stripe) {
      return json({ error: "Stripe not configured." }, 500);
    }

    const signature = req.headers.get("Stripe-Signature") ?? req.headers.get("stripe-signature");
    if (!signature) {
      return json({ error: "Missing signature." }, 400);
    }

    let event: Stripe.Event | null = null;
    let verificationError: Error | null = null;
    for (const secret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch (e) {
        verificationError = e as Error;
      }
    }
    if (!event) {
      console.error("[stripe-webhook] signature verification failed", verificationError?.message ?? "unknown");
      return json({ error: "Invalid signature." }, 400);
    }

    const admin = getServiceRoleSupabase();
    const parsedPayload = JSON.parse(rawBody) as unknown;
    const { row, duplicate } = await insertStripeWebhookInboxEvent(admin, event, parsedPayload);
    if (!row) {
      return json({ error: "Failed to store webhook event." }, 500);
    }

    await touchStripeWebhookReceived(admin, event.id);

    if (duplicate) {
      return json({ received: true, duplicate: true, event_id: event.id }, 200);
    }

    // @ts-ignore Supabase Edge Runtime
    const runtime = typeof EdgeRuntime !== "undefined" ? EdgeRuntime : null;
    const dispatch = dispatchStripeWebhookProcessing(row.id);
    if (runtime?.waitUntil) {
      runtime.waitUntil(dispatch);
    } else {
      void dispatch;
    }

    return json({ received: true, inbox_id: row.id, event_id: event.id }, 200);
  } catch (e) {
    console.error("[stripe-webhook]", (e as Error).message);
    return json({ error: "Processing failed." }, 500);
  }
});
