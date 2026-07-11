import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  amountToCents,
  createStripeClient,
  isStripeConfigured,
} from "../_shared/stripe.ts";
import { getOrCreateStripeCustomer, upsertStripeInvoice } from "../_shared/stripeInvoiceSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type LineItemInput = { description: string; quantity: number; unit_amount: number };
type CreateInvoiceInput = {
  company_id: string;
  project_id?: string;
  currency: string;
  due_date?: string;
  memo?: string;
  line_items: LineItemInput[];
  action: "save_draft" | "finalize" | "finalize_and_send";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await assertSuperAdminUser(req);

    if (!isStripeConfigured()) {
      return json({ error: "Stripe is not configured.", code: "NOT_CONFIGURED" }, 400);
    }

    const stripe = createStripeClient();
    if (!stripe) return json({ error: "Stripe client unavailable." }, 500);

    const input = await req.json() as CreateInvoiceInput;
    if (!input.company_id || !input.line_items?.length) {
      return json({ error: "company_id and line_items are required." }, 400);
    }

    const admin = getServiceRoleSupabase();
    const customerId = await getOrCreateStripeCustomer(admin, stripe, input.company_id);
    const currency = (input.currency ?? "EUR").toLowerCase();

    let projectName: string | null = null;
    if (input.project_id) {
      const { data: project } = await admin.from("projects").select("name").eq("id", input.project_id).maybeSingle();
      projectName = project?.name ?? null;
    }

    for (const item of input.line_items) {
      await stripe.invoiceItems.create({
        customer: customerId,
        description: item.description,
        quantity: item.quantity,
        unit_amount: amountToCents(item.unit_amount),
        currency,
      });
    }

    const stripeInvoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: input.due_date
        ? Math.max(1, Math.ceil((new Date(input.due_date).getTime() - Date.now()) / 86400000))
        : 30,
      description: input.memo ?? undefined,
      metadata: {
        oxus_company_id: input.company_id,
        oxus_project_id: input.project_id ?? "",
      },
    });

    let finalInvoice = stripeInvoice;

    if (input.action === "finalize" || input.action === "finalize_and_send") {
      finalInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    }

    if (input.action === "finalize_and_send") {
      finalInvoice = await stripe.invoices.sendInvoice(stripeInvoice.id);
    }

    await upsertStripeInvoice(admin, finalInvoice, true);

    const { data: localInvoice } = await admin
      .from("invoices")
      .select("id, number, status, hosted_invoice_url, external_url, total, currency")
      .eq("provider", "stripe")
      .eq("external_id", finalInvoice.id)
      .maybeSingle();

    if (localInvoice && input.project_id) {
      await admin.from("invoices").update({
        project_id: input.project_id,
        project: projectName,
      }).eq("id", localInvoice.id);
    }

    return json({
      ok: true,
      invoice: localInvoice,
      stripe_invoice_id: finalInvoice.id,
      hosted_invoice_url: finalInvoice.hosted_invoice_url,
      status: finalInvoice.status,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-create-invoice]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
