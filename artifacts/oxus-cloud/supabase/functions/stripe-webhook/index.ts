import Stripe from "npm:stripe@17.7.0";
import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import { createStripeClient, getStripeWebhookSecret } from "../_shared/stripe.ts";
import { upsertStripeInvoice } from "../_shared/stripeInvoiceSync.ts";

const INVOICE_EVENTS = new Set([
  "invoice.created",
  "invoice.updated",
  "invoice.finalized",
  "invoice.sent",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice.deleted",
]);

Deno.serve(async (req) => {
  const rawBody = await req.text();

  try {
    const webhookSecret = getStripeWebhookSecret();
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: "Webhook secret not configured." }), { status: 500 });
    }

    const stripe = createStripeClient();
    if (!stripe) {
      return new Response(JSON.stringify({ error: "Stripe not configured." }), { status: 500 });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing signature." }), { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (e) {
      console.error("[stripe-webhook] signature verification failed", (e as Error).message);
      return new Response(JSON.stringify({ error: "Invalid signature." }), { status: 400 });
    }

    const admin = getServiceRoleSupabase();

    const { data: existing } = await admin
      .from("stripe_webhook_events")
      .select("id, status")
      .eq("stripe_event_id", event.id)
      .maybeSingle();

    if (existing?.status === "processed") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
    }

    if (!existing) {
      await admin.from("stripe_webhook_events").insert({
        stripe_event_id: event.id,
        event_type: event.type,
        status: "received",
        payload: JSON.parse(rawBody),
      });
    }

    await admin.from("stripe_integration_state").update({
      webhook_last_received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    if (INVOICE_EVENTS.has(event.type)) {
      const invoice = event.data.object as Stripe.Invoice;
      if (event.type === "invoice.deleted") {
        await admin.from("invoices")
          .update({ sync_status: "deleted", last_synced_at: new Date().toISOString() })
          .eq("provider", "stripe")
          .eq("external_id", invoice.id);
      } else {
        await upsertStripeInvoice(admin, invoice, true);
      }
    }

    if (event.type === "customer.created" || event.type === "customer.updated") {
      const customer = event.data.object as Stripe.Customer;
      const companyId = customer.metadata?.oxus_company_id;
      if (companyId && customer.id) {
        await admin.from("company_provider_mappings").upsert({
          company_id: companyId,
          provider: "stripe",
          external_id: customer.id,
          billing_email: customer.email,
          preferred_currency: (customer.currency ?? "eur").toUpperCase(),
        }, { onConflict: "company_id,provider" });
      }
    }

    await admin.from("stripe_webhook_events").update({
      status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("stripe_event_id", event.id);

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (e) {
    console.error("[stripe-webhook]", (e as Error).message);

    try {
      const parsed = JSON.parse(rawBody) as { id?: string };
      if (parsed.id) {
        const admin = getServiceRoleSupabase();
        await admin.from("stripe_webhook_events").update({
          status: "failed",
          error_message: (e as Error).message,
          processed_at: new Date().toISOString(),
        }).eq("stripe_event_id", parsed.id);
      }
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ error: "Processing failed." }), { status: 500 });
  }
});
