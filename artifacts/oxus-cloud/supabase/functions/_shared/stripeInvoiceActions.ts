import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";
import { createStripeClient } from "./stripe.ts";
import { upsertStripeInvoice } from "./stripeInvoiceSync.ts";

export type StripeInvoiceAction =
  | "finalize"
  | "send"
  | "mark_paid_out_of_band"
  | "void"
  | "mark_uncollectible"
  | "delete_draft";

const OPEN_STATUSES = new Set(["open"]);
const DRAFT_STATUSES = new Set(["draft"]);

export async function logInvoiceAction(
  admin: SupabaseClient,
  entry: {
    invoice_id: string;
    external_id: string | null;
    action: string;
    actor_id: string;
    previous_stripe_status: string | null;
    resulting_stripe_status: string | null;
    success: boolean;
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await admin.from("invoice_action_logs").insert({
    invoice_id: entry.invoice_id,
    external_id: entry.external_id,
    action: entry.action,
    actor_id: entry.actor_id,
    previous_stripe_status: entry.previous_stripe_status,
    resulting_stripe_status: entry.resulting_stripe_status,
    success: entry.success,
    error_message: entry.error_message ?? null,
    metadata: entry.metadata ?? {},
  });
}

async function retrieveStripeInvoice(stripe: Stripe, externalId: string): Promise<Stripe.Invoice> {
  return stripe.invoices.retrieve(externalId);
}

export async function executeStripeInvoiceAction(
  admin: SupabaseClient,
  userId: string,
  invoiceId: string,
  action: StripeInvoiceAction,
): Promise<{ invoice: Record<string, unknown>; already_done?: boolean; message?: string }> {
  const stripe = createStripeClient();
  if (!stripe) throw new Error("Stripe is not configured.");

  const { data: local, error: loadErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (loadErr || !local) throw new Error("Invoice not found.");
  if (local.provider !== "stripe") throw new Error("This action requires a Stripe invoice.");
  if (!local.external_id) throw new Error("Stripe external_id is missing on this invoice.");

  const externalId = local.external_id as string;
  let current = await retrieveStripeInvoice(stripe, externalId);
  const prevStatus = current.status ?? null;

  if (action === "mark_paid_out_of_band") {
    if (current.status === "paid") {
      await upsertStripeInvoice(admin, current, true);
      const { data: refreshed } = await admin.from("invoices").select("*, invoice_line_items(*)").eq("id", invoiceId).single();
      return { invoice: refreshed ?? local, already_done: true, message: "Invoice is already paid in Stripe." };
    }
    if (current.status === "draft") {
      throw new Error("Draft invoices must be finalized before marking paid. Use Finalize first.");
    }
    if (!OPEN_STATUSES.has(current.status ?? "") && current.status !== "uncollectible") {
      throw new Error(`Cannot mark paid from Stripe status: ${current.status}`);
    }
    current = await stripe.invoices.pay(externalId, { paid_out_of_band: true });
  } else if (action === "finalize") {
    if (current.status !== "draft") {
      throw new Error(`Cannot finalize invoice in status: ${current.status}`);
    }
    current = await stripe.invoices.finalizeInvoice(externalId);
  } else if (action === "send") {
    if (current.status === "draft") {
      current = await stripe.invoices.finalizeInvoice(externalId);
    }
    if (current.status === "open") {
      current = await stripe.invoices.sendInvoice(externalId);
    } else if (current.status === "paid") {
      return { invoice: local, already_done: true, message: "Invoice is already paid." };
    } else {
      throw new Error(`Cannot send invoice in status: ${current.status}`);
    }
  } else if (action === "void") {
    if (current.status === "paid") throw new Error("Paid invoices cannot be voided.");
    if (current.status === "void") {
      return { invoice: local, already_done: true, message: "Invoice is already void." };
    }
    current = await stripe.invoices.voidInvoice(externalId);
  } else if (action === "mark_uncollectible") {
    if (current.status === "paid" || current.status === "void") {
      throw new Error(`Cannot mark uncollectible from status: ${current.status}`);
    }
    current = await stripe.invoices.markUncollectible(externalId);
  } else if (action === "delete_draft") {
    if (!DRAFT_STATUSES.has(current.status ?? "")) {
      throw new Error("Only draft invoices can be deleted.");
    }
    await stripe.invoices.del(externalId);
    await admin.from("invoices").update({
      sync_status: "deleted",
      stripe_status: "deleted",
      last_synced_at: new Date().toISOString(),
    }).eq("id", invoiceId);
    await logInvoiceAction(admin, {
      invoice_id: invoiceId,
      external_id: externalId,
      action,
      actor_id: userId,
      previous_stripe_status: prevStatus,
      resulting_stripe_status: "deleted",
      success: true,
    });
    const { data: updated } = await admin.from("invoices").select("*, invoice_line_items(*)").eq("id", invoiceId).single();
    return { invoice: updated ?? local };
  }

  await upsertStripeInvoice(admin, current, true);

  await logInvoiceAction(admin, {
    invoice_id: invoiceId,
    external_id: externalId,
    action,
    actor_id: userId,
    previous_stripe_status: prevStatus,
    resulting_stripe_status: current.status ?? null,
    success: true,
  });

  const { data: updated } = await admin
    .from("invoices")
    .select("*, invoice_line_items(*)")
    .eq("id", invoiceId)
    .single();

  return { invoice: updated ?? local };
}

export async function updateInvoiceProjectMapping(
  admin: SupabaseClient,
  userId: string,
  invoiceId: string,
  projectId: string | null,
): Promise<{ invoice: Record<string, unknown>; stripe_metadata_warning?: string }> {
  const { data: local, error: loadErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (loadErr || !local) throw new Error("Invoice not found.");

  let projectName: string | null = null;
  if (projectId) {
    const { data: project } = await admin.from("projects").select("id, name, client_id, organization_id").eq("id", projectId).maybeSingle();
    if (!project) throw new Error("Project not found.");
    projectName = project.name;
  }

  const { error: updateErr } = await admin.from("invoices").update({
    project_id: projectId,
    project: projectName,
    updated_at: new Date().toISOString(),
  }).eq("id", invoiceId);
  if (updateErr) throw new Error(updateErr.message);

  let stripeWarning: string | undefined;
  if (local.provider === "stripe" && local.external_id) {
    const stripe = createStripeClient();
    if (stripe) {
      try {
        const inv = await stripe.invoices.retrieve(local.external_id as string);
        if (inv.status !== "void" && inv.status !== "deleted") {
          await stripe.invoices.update(local.external_id as string, {
            metadata: {
              ...(inv.metadata ?? {}),
              oxus_project_id: projectId ?? "",
              oxus_project_name: projectName ?? "",
            },
          });
        }
      } catch (e) {
        stripeWarning = `Local project saved, but Stripe metadata update failed: ${(e as Error).message}`;
      }
    }
  }

  await logInvoiceAction(admin, {
    invoice_id: invoiceId,
    external_id: local.external_id as string | null,
    action: "update_project",
    actor_id: userId,
    previous_stripe_status: local.stripe_status as string | null,
    resulting_stripe_status: local.stripe_status as string | null,
    success: true,
    metadata: { project_id: projectId, project_name: projectName },
  });

  const { data: updated } = await admin.from("invoices").select("*, invoice_line_items(*)").eq("id", invoiceId).single();
  return { invoice: updated ?? local, stripe_metadata_warning: stripeWarning };
}
