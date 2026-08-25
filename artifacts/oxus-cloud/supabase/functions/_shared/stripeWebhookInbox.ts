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

export type StripeWebhookClaimResult =
  | { state: "claimed"; row: StripeWebhookInboxRow }
  | { state: "terminal"; row: StripeWebhookInboxRow }
  | { state: "busy"; row: StripeWebhookInboxRow }
  | { state: "missing"; row: null };

function extractObjectId(event: Stripe.Event): string | null {
  const obj = event.data?.object as { id?: string } | undefined;
  return typeof obj?.id === "string" ? obj.id : null;
}

export async function insertStripeWebhookInboxEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
  rawPayload: unknown,
): Promise<{ row: StripeWebhookInboxRow | null; duplicate: boolean }> {
  const { data: existing, error: existingError } = await admin
    .from("stripe_webhook_events")
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (existing) {
    return {
      row: existing as StripeWebhookInboxRow,
      duplicate:
        existing.status === "processed" || existing.status === "ignored",
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
        .select(
          "id, stripe_event_id, event_type, status, payload, attempt_count",
        )
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
): Promise<StripeWebhookClaimResult> {
  const now = new Date().toISOString();
  const { data: beforeClaim, error: beforeClaimError } = await admin
    .from("stripe_webhook_events")
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .eq("id", inboxId)
    .maybeSingle();

  if (beforeClaimError) throw new Error(beforeClaimError.message);
  if (!beforeClaim) return { state: "missing", row: null };
  if (beforeClaim.status === "processed" || beforeClaim.status === "ignored") {
    return { state: "terminal", row: beforeClaim as StripeWebhookInboxRow };
  }
  if (beforeClaim.status === "processing") {
    return { state: "busy", row: beforeClaim as StripeWebhookInboxRow };
  }

  // Claim directly from a claimable state. This is a single conditional UPDATE,
  // so concurrent deliveries cannot both acquire the same inbox row.
  const { data: claimed, error } = await admin
    .from("stripe_webhook_events")
    .update({
      status: "processing",
      processing_started_at: now,
      attempt_count: Number(beforeClaim.attempt_count ?? 0) + 1,
      error_message: null,
    })
    .eq("id", inboxId)
    .in("status", ["pending", "received", "failed"])
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (claimed) {
    return { state: "claimed", row: claimed as StripeWebhookInboxRow };
  }

  const { data: current, error: currentError } = await admin
    .from("stripe_webhook_events")
    .select("id, stripe_event_id, event_type, status, payload, attempt_count")
    .eq("id", inboxId)
    .maybeSingle();

  if (currentError) throw new Error(currentError.message);
  if (!current) return { state: "missing", row: null };
  if (current.status === "processed" || current.status === "ignored") {
    return { state: "terminal", row: current as StripeWebhookInboxRow };
  }
  return { state: "busy", row: current as StripeWebhookInboxRow };
}

export async function markStripeWebhookInboxProcessed(
  admin: SupabaseClient,
  inboxId: string,
  stripeEventId: string,
  outcome: "processed" | "ignored",
): Promise<void> {
  const now = new Date().toISOString();
  const { error: eventError } = await admin
    .from("stripe_webhook_events")
    .update({
      status: outcome,
      processed_at: now,
      processing_started_at: null,
      error_message: null,
    })
    .eq("id", inboxId);
  if (eventError) throw new Error(eventError.message);

  const { error: stateError } = await admin
    .from("stripe_integration_state")
    .update({
      webhook_last_processed_at: now,
      webhook_last_event_id: stripeEventId,
      updated_at: now,
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (stateError) throw new Error(stateError.message);
}

export async function markStripeWebhookInboxFailed(
  admin: SupabaseClient,
  inboxId: string,
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("stripe_webhook_events")
    .update({
      status: "failed",
      processed_at: now,
      processing_started_at: null,
      error_message: message.slice(0, 1000),
    })
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
}

export async function touchStripeWebhookReceived(
  admin: SupabaseClient,
  stripeEventId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("stripe_integration_state")
    .update({
      webhook_last_received_at: now,
      webhook_last_event_id: stripeEventId,
      updated_at: now,
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(error.message);
}
