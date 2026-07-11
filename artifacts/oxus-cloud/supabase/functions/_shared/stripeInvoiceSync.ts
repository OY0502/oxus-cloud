import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";
import { centsToAmount, mapStripeInvoiceStatus } from "./stripe.ts";

export type StripeSyncResult = {
  checked: number;
  imported: number;
  updated: number;
  unchanged: number;
  companies_matched: number;
  companies_requiring_review: number;
  errors: string[];
};

async function findCompanyByStripeCustomer(
  admin: SupabaseClient,
  customerId: string,
): Promise<{ companyId: string | null; mappingStatus: string }> {
  const { data: mapping } = await admin
    .from("company_provider_mappings")
    .select("company_id")
    .eq("provider", "stripe")
    .eq("external_id", customerId)
    .maybeSingle();

  if (mapping?.company_id) {
    return { companyId: mapping.company_id, mappingStatus: "resolved" };
  }

  return { companyId: null, mappingStatus: "unresolved" };
}

async function upsertStripeCustomerMapping(
  admin: SupabaseClient,
  companyId: string,
  customerId: string,
  email: string | null,
  currency: string | null,
): Promise<void> {
  await admin.from("company_provider_mappings").upsert(
    {
      company_id: companyId,
      provider: "stripe",
      external_id: customerId,
      billing_email: email,
      preferred_currency: currency?.toUpperCase() ?? "EUR",
    },
    { onConflict: "company_id,provider" },
  );
}

function invoiceChanged(existing: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const keys = [
    "status", "amount", "amount_paid", "amount_due", "total", "subtotal", "tax_amount",
    "amount_eur", "amount_due_eur", "amount_paid_eur", "fx_status",
    "hosted_invoice_url", "external_url", "sync_status", "company_mapping_status",
    "client_id", "due_date", "paid_date",
  ];
  return keys.some((k) => String(existing[k] ?? "") !== String(next[k] ?? ""));
}

export async function upsertStripeInvoice(
  admin: SupabaseClient,
  stripeInvoice: Stripe.Invoice,
  force = false,
): Promise<"imported" | "updated" | "unchanged"> {
  const customerId = typeof stripeInvoice.customer === "string"
    ? stripeInvoice.customer
    : stripeInvoice.customer?.id ?? null;

  let companyId: string | null = null;
  let mappingStatus = "unresolved";

  if (customerId) {
    const match = await findCompanyByStripeCustomer(admin, customerId);
    companyId = match.companyId;
    mappingStatus = match.mappingStatus;

    if (!companyId && stripeInvoice.customer_email) {
      const { data: client } = await admin
        .from("clients")
        .select("id")
        .or(`billing_email.eq.${stripeInvoice.customer_email},name.ilike.${stripeInvoice.customer_name ?? ""}`)
        .limit(1)
        .maybeSingle();
      if (client?.id) {
        companyId = client.id;
        mappingStatus = "auto_matched";
        await upsertStripeCustomerMapping(
          admin,
          client.id,
          customerId,
          stripeInvoice.customer_email,
          stripeInvoice.currency,
        );
      }
    }
  }

  const total = centsToAmount(stripeInvoice.total);
  const subtotal = centsToAmount(stripeInvoice.subtotal);
  const tax = centsToAmount(stripeInvoice.tax ?? 0);
  const amountPaid = centsToAmount(stripeInvoice.amount_paid);
  const amountDue = centsToAmount(stripeInvoice.amount_due);
  const status = mapStripeInvoiceStatus(stripeInvoice.status);

  const currency = (stripeInvoice.currency ?? "eur").toUpperCase();
  const isNativeEur = currency === "EUR";

  const payload = {
    number: stripeInvoice.number ?? `STRIPE-${stripeInvoice.id.slice(-8)}`,
    client_id: companyId,
    client_name: stripeInvoice.customer_name ?? stripeInvoice.customer_email ?? null,
    amount: total,
    amount_paid: amountPaid,
    amount_due: amountDue,
    total,
    subtotal,
    tax_amount: tax,
    status,
    issue_date: stripeInvoice.created
      ? new Date(stripeInvoice.created * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    due_date: stripeInvoice.due_date
      ? new Date(stripeInvoice.due_date * 1000).toISOString().slice(0, 10)
      : null,
    paid_date: stripeInvoice.status_transitions?.paid_at
      ? new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString().slice(0, 10)
      : null,
    issued_at: stripeInvoice.created ? new Date(stripeInvoice.created * 1000).toISOString() : null,
    due_at: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000).toISOString() : null,
    paid_at: stripeInvoice.status_transitions?.paid_at
      ? new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString()
      : null,
    provider: "stripe",
    external_id: stripeInvoice.id,
    external_customer_id: customerId,
    external_url: stripeInvoice.livemode
      ? `https://dashboard.stripe.com/invoices/${stripeInvoice.id}`
      : `https://dashboard.stripe.com/test/invoices/${stripeInvoice.id}`,
    hosted_invoice_url: stripeInvoice.hosted_invoice_url ?? null,
    currency,
    amount_eur: isNativeEur ? total : null,
    amount_due_eur: isNativeEur ? amountDue : null,
    amount_paid_eur: isNativeEur ? amountPaid : null,
    subtotal_eur: isNativeEur ? subtotal : null,
    tax_amount_eur: isNativeEur ? tax : null,
    fx_status: isNativeEur ? "native_eur" : "pending",
    fx_rate_to_eur: isNativeEur ? 1 : null,
    fx_rate_date: isNativeEur
      ? (stripeInvoice.status_transitions?.paid_at
        ? new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString().slice(0, 10)
        : stripeInvoice.created
          ? new Date(stripeInvoice.created * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10))
      : null,
    stripe_status: stripeInvoice.status ?? null,
    sync_status: "synced",
    last_synced_at: new Date().toISOString(),
    company_mapping_status: mappingStatus,
    payment_method: "stripe",
  };

  const { data: existing } = await admin
    .from("invoices")
    .select("*")
    .eq("provider", "stripe")
    .eq("external_id", stripeInvoice.id)
    .maybeSingle();

  if (!existing) {
    const { data: inserted, error } = await admin
      .from("invoices")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const lines = stripeInvoice.lines?.data ?? [];
    if (lines.length > 0 && inserted?.id) {
      await admin.from("invoice_line_items").delete().eq("invoice_id", inserted.id);
      await admin.from("invoice_line_items").insert(
        lines.map((line, i) => ({
          invoice_id: inserted.id,
          description: line.description ?? "Line item",
          quantity: line.quantity ?? 1,
          unit_amount: centsToAmount(line.unit_amount ?? line.amount ?? 0),
          amount: centsToAmount(line.amount ?? 0),
          line_total: centsToAmount(line.amount ?? 0),
          position: i,
        })),
      );
    }
    return "imported";
  }

  if (!force && !invoiceChanged(existing, payload)) {
    return "unchanged";
  }

  const { error: updateError } = await admin
    .from("invoices")
    .update(payload)
    .eq("id", existing.id);
  if (updateError) throw new Error(updateError.message);

  const lines = stripeInvoice.lines?.data ?? [];
  if (lines.length > 0) {
    await admin.from("invoice_line_items").delete().eq("invoice_id", existing.id);
    await admin.from("invoice_line_items").insert(
      lines.map((line, i) => ({
        invoice_id: existing.id,
        description: line.description ?? "Line item",
        quantity: line.quantity ?? 1,
        unit_amount: centsToAmount(line.unit_amount ?? line.amount ?? 0),
        amount: centsToAmount(line.amount ?? 0),
        line_total: centsToAmount(line.amount ?? 0),
        position: i,
      })),
    );
  }

  return "updated";
}

export async function syncStripeInvoices(
  admin: SupabaseClient,
  stripe: Stripe,
  options?: { force?: boolean; created_after?: string },
): Promise<StripeSyncResult> {
  const result: StripeSyncResult = {
    checked: 0,
    imported: 0,
    updated: 0,
    unchanged: 0,
    companies_matched: 0,
    companies_requiring_review: 0,
    errors: [],
  };

  const matchedCompanies = new Set<string>();
  const unresolved = new Set<string>();

  let startingAfter: string | undefined;
  const created: Stripe.InvoiceListParams["created"] = options?.created_after
    ? { gte: Math.floor(new Date(options.created_after).getTime() / 1000) }
    : undefined;

  for (;;) {
    const page = await stripe.invoices.list({
      limit: 100,
      starting_after: startingAfter,
      created,
      expand: ["data.customer"],
    });

    for (const inv of page.data) {
      result.checked += 1;
      try {
        const outcome = await upsertStripeInvoice(admin, inv, options?.force ?? false);
        if (outcome === "imported") result.imported += 1;
        else if (outcome === "updated") result.updated += 1;
        else result.unchanged += 1;

        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        if (customerId) {
          const { data: mapping } = await admin
            .from("company_provider_mappings")
            .select("company_id")
            .eq("provider", "stripe")
            .eq("external_id", customerId)
            .maybeSingle();
          if (mapping?.company_id) matchedCompanies.add(customerId);
          else unresolved.add(customerId);
        }
      } catch (e) {
        result.errors.push(`${inv.id}: ${(e as Error).message}`);
      }
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]?.id;
  }

  result.companies_matched = matchedCompanies.size;
  result.companies_requiring_review = unresolved.size;

  await admin.from("stripe_integration_state").update({
    configured: true,
    last_successful_sync_at: new Date().toISOString(),
    last_sync_error: result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : null,
    updated_at: new Date().toISOString(),
  }).neq("id", "00000000-0000-0000-0000-000000000000");

  return result;
}

export async function getOrCreateStripeCustomer(
  admin: SupabaseClient,
  stripe: Stripe,
  companyId: string,
): Promise<string> {
  const { data: mapping } = await admin
    .from("company_provider_mappings")
    .select("external_id, billing_email")
    .eq("company_id", companyId)
    .eq("provider", "stripe")
    .maybeSingle();

  if (mapping?.external_id) return mapping.external_id;

  const { data: company, error } = await admin
    .from("clients")
    .select("id, name, billing_email, website")
    .eq("id", companyId)
    .single();
  if (error || !company) throw new Error("Company not found.");

  const customer = await stripe.customers.create({
    name: company.name,
    email: company.billing_email ?? undefined,
    metadata: { oxus_company_id: companyId },
  });

  await admin.from("company_provider_mappings").upsert({
    company_id: companyId,
    provider: "stripe",
    external_id: customer.id,
    billing_email: company.billing_email,
  }, { onConflict: "company_id,provider" });

  return customer.id;
}
