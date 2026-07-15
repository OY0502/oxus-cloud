import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";

export type StripeWebhookInboxRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  status: string;
  payload: Stripe.Event | null;
  attempt_count: number;
};

function extractObjectId(event: Stripe.Event): string | null {
  const obj = event.data?.object as { id?: string } | undefined;
  return typeof obj?.id === "string" ? obj.id : null;
}

export async function insertStripeWebhookInboxEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
  rawPayload: unknown,
): Promise<{ row: StripeWebhookInboxRow | null; duplicate: boolean }> {
  const { data: existing } = await admin
    .from("stripe_webhook_events")
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existing) {
    return {
      row: existing as StripeWebhookInboxRow,
      duplicate: existing.status === "processed" || existing.status === "ignored",
    };
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await admin
    .from("stripe_webhook_events")
    .insert({
      stripe_event_id: event.id,
      provider: "stripe",
      event_type: event.type,
      status: "pending",
      payload: rawPayload,
      livemode: event.livemode ?? null,
      api_version: event.api_version ?? null,
      object_id: extractObjectId(event),
      attempt_count: 0,
      received_at: now,
      created_at: now,
      error_message: null,
    })
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await admin
        .from("stripe_webhook_events")
        .select("id, stripe_event_id, event_type, status, payload, attempt_count")
        .eq("stripe_event_id", event.id)
        .maybeSingle();
      return {
        row: raced as StripeWebhookInboxRow | null,
        duplicate: raced?.status === "processed" || raced?.status === "ignored",
      };
    }
    throw new Error(error.message);
  }

  return { row: inserted as StripeWebhookInboxRow, duplicate: false };
}

export async function claimStripeWebhookInboxEvent(
  admin: SupabaseClient,
  inboxId: string,
): Promise<StripeWebhookInboxRow | null> {
  const now = new Date().toISOString();
  const { data: current } = await admin
    .from("stripe_webhook_events")
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .eq("id", inboxId)
    .maybeSingle();

  if (!current) return null;
  if (current.status === "processed" || current.status === "ignored") {
    return current as StripeWebhookInboxRow;
  }

  const { data: claimed, error } = await admin
    .from("stripe_webhook_events")
    .update({
      status: "processing",
      processing_started_at: now,
      attempt_count: Number(current.attempt_count ?? 0) + 1,
      error_message: null,
    })
    .eq("id", inboxId)
    .in("status", ["pending", "received", "failed", "processing"])
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (claimed ?? current) as StripeWebhookInboxRow;
}

export async function markStripeWebhookInboxProcessed(
  admin: SupabaseClient,
  inboxId: string,
  stripeEventId: string,
  outcome: "processed" | "ignored",
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("stripe_webhook_events").update({
    status: outcome,
    processed_at: now,
    error_message: null,
  }).eq("id", inboxId);

  await admin.from("stripe_integration_state").update({
    webhook_last_processed_at: now,
    webhook_last_event_id: stripeEventId,
    updated_at: now,
  }).neq("id", "00000000-0000-0000-0000-000000000000");
}

export async function markStripeWebhookInboxFailed(
  admin: SupabaseClient,
  inboxId: string,
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("stripe_webhook_events").update({
    status: "failed",
    processed_at: now,
    error_message: message.slice(0, 1000),
  }).eq("id", inboxId);
}

export async function touchStripeWebhookReceived(
  admin: SupabaseClient,
  stripeEventId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("stripe_integration_state").update({
    webhook_last_received_at: now,
    webhook_last_event_id: stripeEventId,
    updated_at: now,
  }).neq("id", "00000000-0000-0000-0000-000000000000");
}
