import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";
import { createStripeClient } from "./stripe.ts";
import { upsertStripeInvoice } from "./stripeInvoiceSync.ts";
import { reconcileStripeInvoice } from "./stripePaymentReconcile.ts";

export const STRIPE_INVOICE_EVENTS = new Set([
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

export const STRIPE_CUSTOMER_EVENTS = new Set([
  "customer.created",
  "customer.updated",
]);

export const STRIPE_SUPPORTED_EVENTS = new Set([
  ...STRIPE_INVOICE_EVENTS,
  ...STRIPE_CUSTOMER_EVENTS,
]);

export type StripeWebhookProcessResult = {
  outcome: "processed" | "ignored" | "duplicate";
  event_type: string;
  stripe_event_id: string;
  object_id: string | null;
};

function extractObjectId(event: Stripe.Event): string | null {
  const obj = event.data?.object as { id?: string } | undefined;
  return typeof obj?.id === "string" ? obj.id : null;
}

async function processInvoiceEvent(
  admin: SupabaseClient,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  let invoice = event.data.object as Stripe.Invoice;
  if (event.type !== "invoice.deleted" && invoice?.id) {
    try {
      invoice = await stripe.invoices.retrieve(invoice.id);
    } catch (err) {
      console.warn("[stripe-webhook-processor] invoice retrieve failed, using event payload", (err as Error).message);
    }
  }

  if (event.type === "invoice.deleted") {
    await admin.from("invoices")
      .update({ sync_status: "deleted", last_synced_at: new Date().toISOString() })
      .eq("provider", "stripe")
      .eq("external_id", invoice.id);
    return;
  }

  await upsertStripeInvoice(admin, invoice, true);

  const { data: dbInvoice } = await admin
    .from("invoices")
    .select("id, number, external_id, provider, status, currency, total, amount, amount_paid, issue_date, paid_date, paid_at, client_name")
    .eq("provider", "stripe")
    .eq("external_id", invoice.id)
    .maybeSingle();

  if (!dbInvoice) return;

  if (event.type === "invoice.paid" || invoice.status === "paid") {
    try {
      await reconcileStripeInvoice(admin, stripe, dbInvoice);
    } catch (reconcileErr) {
      console.warn("[stripe-webhook-processor] payment reconciliation failed", (reconcileErr as Error).message);
    }
  }

  try {
    await admin.rpc("process_client_invoice_payable_release", { p_invoice_id: dbInvoice.id });
  } catch (releaseErr) {
    console.warn("[stripe-webhook-processor] payable release failed", (releaseErr as Error).message);
  }
}

async function processCustomerEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  const customer = event.data.object as Stripe.Customer;
  const companyId = customer.metadata?.oxus_company_id;
  if (!companyId || !customer.id) return;

  await admin.from("company_provider_mappings").upsert({
    company_id: companyId,
    provider: "stripe",
    external_id: customer.id,
    billing_email: customer.email,
    preferred_currency: (customer.currency ?? "eur").toUpperCase(),
  }, { onConflict: "company_id,provider" });
}

export async function processStripeWebhookEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
  stripe?: Stripe | null,
): Promise<StripeWebhookProcessResult> {
  if (!STRIPE_SUPPORTED_EVENTS.has(event.type)) {
    return {
      outcome: "ignored",
      event_type: event.type,
      stripe_event_id: event.id,
      object_id: extractObjectId(event),
    };
  }

  const client = stripe ?? createStripeClient();
  if (!client) throw new Error("Stripe client unavailable.");

  if (STRIPE_INVOICE_EVENTS.has(event.type)) {
    await processInvoiceEvent(admin, client, event);
  } else if (STRIPE_CUSTOMER_EVENTS.has(event.type)) {
    await processCustomerEvent(admin, event);
  }

  return {
    outcome: "processed",
    event_type: event.type,
    stripe_event_id: event.id,
    object_id: extractObjectId(event),
  };
}
