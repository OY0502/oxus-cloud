import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export function isMissingStripeInvoice(error: unknown): boolean {
  const err = error as { code?: string; statusCode?: number; param?: string; message?: string } | null;
  return err?.code === "resource_missing" && err.statusCode === 404
    && (err.param === "invoice" || /^No such invoice:/.test(err.message ?? ""));
}

// Keep a tombstone for audit history while removing the invoice from app views.
export async function markStripeInvoiceDeleted(admin: SupabaseClient, externalId: string) {
  const { error } = await admin.from("invoices").update({
    sync_status: "deleted",
    stripe_status: "deleted",
    last_synced_at: new Date().toISOString(),
  }).eq("provider", "stripe").eq("external_id", externalId);
  if (error) throw new Error(error.message);
}
